/**
 * Multi-agent orchestrator for /api/explain.
 *
 * Pipeline:
 *   Router (Haiku, mode + intent)
 *     → Retriever (BM25, top-K chunks)
 *       → Planner (Sonnet, pedagogical plan)
 *         → Author (Sonnet, streaming, writes content)
 *           → Critic (Haiku, reviews against plan)
 *             → Refiner (Sonnet, only if Critic flags issues)
 *
 * Each step emits an agent_step SSE event so the client can render the
 * pipeline live. Pattern is ReAct + Reflexion: explicit roles, structured
 * tool inputs, self-critique, optional revision.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { client, MAIN_MODEL, FAST_MODEL, findToolUse } from './anthropic.js';
import type { RetrievedChunk } from './retriever.js';
import { retrieve } from './retriever.js';
import { parse as partialParse, Allow } from 'partial-json';
import { embed, cosine } from './embeddings.js';
import { semanticLookup } from './cache.js';

export type AgentName =
  | 'memory'
  | 'router'
  | 'retriever'
  | 'planner'
  | 'author'
  | 'critic'
  | 'refiner';
export type AgentStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface AgentTrace {
  id: string;
  agent: AgentName;
  label: string;
  model?: string;
  status: AgentStatus;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  cacheReadTokens?: number;
  preview?: string;
  detail?: string;
  error?: string;
}

export type EmitFn = (trace: AgentTrace) => void;
export type PartialFn = (data: Record<string, unknown>) => void;

export interface RecentLesson { id?: string; title: string; sourceText?: string }

export interface OrchestrateInput {
  text: string;
  question?: string;
  parentTitle?: string;
  docSummary?: string;
  docId?: string;
  recentLessons?: RecentLesson[];
  force?: 'text' | 'visual_html' | 'video_manim';
}

export type LessonMode = 'text' | 'visual_html' | 'video_manim';

export interface PlannerOutput {
  title: string;
  summary: string;
  beats: { label: string; intent: string; viz?: string }[];
  approach: string;
  prerequisites?: { title: string; brief: string }[];
  manim_brief?: string;
}

export interface AuthoredContent {
  html: string;
  css: string;
  js: string;
}

export interface OrchestrateResult {
  mode: LessonMode;
  title: string;
  summary: string;
  prerequisites: { title: string; brief: string }[];
  content?: AuthoredContent;
  manimBrief?: string;
}

const REDIRECT_THRESHOLD = Number(process.env.MEMORY_REDIRECT_THRESHOLD ?? 0.70);
const SEMANTIC_THRESHOLD = Number(process.env.MEMORY_SEMANTIC_THRESHOLD ?? 0.72);

export type MemoryResult =
  | { kind: 'redirect'; frameId: string; matchTitle: string; score: number; embedding: Float32Array }
  | { kind: 'semantic_hit'; cacheKey: string; matchedQuery: string; score: number; embedding: Float32Array }
  | { kind: 'miss'; embedding: Float32Array };

function fmtScore(s: number): string {
  return s.toFixed(3);
}

/**
 * Memory agent: embeds the current query and checks two reuse paths in
 * parallel:
 *   1. Frame-level redirect — does the highlight match an existing
 *      lesson on the user's canvas? If yes, focus that frame instead
 *      of generating a new one.
 *   2. Semantic cache hit — has any prior generation (across sessions)
 *      produced a lesson for a sufficiently similar query? Reuse it.
 *
 * Returns the embedding regardless so the caller can persist it into
 * the semantic index after the pipeline completes.
 */
export async function runMemory(
  input: OrchestrateInput,
  emit: EmitFn,
): Promise<MemoryResult> {
  const trace = startTrace('memory', 'Check semantic memory', 'MiniLM-L6 (local)');
  emit(trace);
  try {
    const query = `${input.text} ${input.question ?? ''}`.trim();
    const queryEmb = await embed(query);

    // 1. Frame redirect — embed each recent frame title and find max similarity.
    let bestFrame: { id: string; title: string; score: number } | null = null;
    if (input.recentLessons?.length) {
      const candidates = input.recentLessons
        .filter((r) => r.id && r.title)
        .map((r) => ({ id: r.id!, title: r.title, source: r.sourceText ?? '' }));
      const titleEmbs = await Promise.all(
        candidates.map((c) => embed(`${c.title} ${c.source.slice(0, 200)}`)),
      );
      for (let i = 0; i < candidates.length; i++) {
        const score = cosine(queryEmb, titleEmbs[i]);
        if (score > (bestFrame?.score ?? -1)) {
          bestFrame = { id: candidates[i].id, title: candidates[i].title, score };
        }
      }
    }
    if (bestFrame && bestFrame.score >= REDIRECT_THRESHOLD) {
      finishTrace(trace, {
        preview: `redirect → "${bestFrame.title}" · cosine ${fmtScore(bestFrame.score)}`,
        detail: `Query: "${query.slice(0, 200)}"\nMatched existing frame: "${bestFrame.title}" (id ${bestFrame.id})\nCosine similarity: ${fmtScore(bestFrame.score)} (threshold ${REDIRECT_THRESHOLD})\nFocusing existing frame instead of generating a new lesson.`,
      });
      emit(trace);
      return {
        kind: 'redirect',
        frameId: bestFrame.id,
        matchTitle: bestFrame.title,
        score: bestFrame.score,
        embedding: queryEmb,
      };
    }

    // 2. Semantic cache lookup — across all prior generations.
    const semHit = await semanticLookup(queryEmb, SEMANTIC_THRESHOLD);
    if (semHit) {
      finishTrace(trace, {
        preview: `semantic cache hit · cosine ${fmtScore(semHit.score)} → "${semHit.entry.query.slice(0, 60)}"`,
        detail: `Query: "${query.slice(0, 200)}"\nMatched cached lesson: "${semHit.entry.query}"\nCosine similarity: ${fmtScore(semHit.score)} (threshold ${SEMANTIC_THRESHOLD})\nReusing cached content; pipeline short-circuits.`,
      });
      emit(trace);
      return {
        kind: 'semantic_hit',
        cacheKey: semHit.entry.cacheKey,
        matchedQuery: semHit.entry.query,
        score: semHit.score,
        embedding: queryEmb,
      };
    }

    // No match.
    const detail = bestFrame
      ? `Best frame match was "${bestFrame.title}" at ${fmtScore(bestFrame.score)} (below redirect threshold ${REDIRECT_THRESHOLD}).\nNo semantic cache hit above ${SEMANTIC_THRESHOLD}.\nProceeding with full pipeline.`
      : `No prior frames to compare. No semantic cache hit above ${SEMANTIC_THRESHOLD}.\nProceeding with full pipeline.`;
    finishTrace(trace, {
      preview: bestFrame ? `miss · best ${fmtScore(bestFrame.score)} below ${REDIRECT_THRESHOLD}` : 'miss · no priors',
      detail,
    });
    emit(trace);
    return { kind: 'miss', embedding: queryEmb };
  } catch (err) {
    finishTrace(trace, { status: 'error', error: (err as Error).message, preview: 'embedding failed — skipping memory' });
    emit(trace);
    // Return a degenerate "miss" with a zero vector so the caller can still
    // proceed without crashing.
    return { kind: 'miss', embedding: new Float32Array(384) };
  }
}

let __id = 0;
function nextId() { return `step_${++__id}_${Math.random().toString(36).slice(2, 8)}`; }

function startTrace(agent: AgentName, label: string, model?: string): AgentTrace {
  return {
    id: nextId(),
    agent,
    label,
    model,
    status: 'running',
    startedAt: Date.now(),
  };
}

function finishTrace(trace: AgentTrace, patch: Partial<AgentTrace>) {
  trace.status = patch.status ?? 'done';
  trace.finishedAt = Date.now();
  trace.durationMs = trace.finishedAt - (trace.startedAt ?? trace.finishedAt);
  Object.assign(trace, patch);
  return trace;
}

function tokensFromUsage(u?: Anthropic.Messages.Usage): { in?: number; out?: number; cacheRead?: number } {
  if (!u) return {};
  return {
    in: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    out: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? undefined,
  };
}

const ROUTER_TOOL = {
  name: 'route_lesson',
  description: 'Choose the best lesson type and write a one-line intent.',
  input_schema: {
    type: 'object' as const,
    properties: {
      mode: {
        type: 'string',
        enum: ['text', 'visual_html', 'video_manim'],
        description: 'text=prose; visual_html=interactive HTML/CSS/JS; video_manim=Manim animation.',
      },
      intent: {
        type: 'string',
        description: 'One sentence describing what this lesson should teach.',
      },
      reason: {
        type: 'string',
        description: 'One sentence explaining why this mode fits.',
      },
    },
    required: ['mode', 'intent', 'reason'],
  },
};

const ROUTER_SYSTEM = `You route a learner's highlight to the best lesson type. **Default to visual_html.** Almost every technical concept benefits from at least one small interactive visualization, even if it's just a slider that demonstrates the idea concretely. A good lesson is "interactive demo + short explanation," not a wall of prose.

Choose ONE:

- **visual_html (DEFAULT — pick this unless one of the others clearly fits)**: an interactive HTML/CSS/JS lesson using D3 / KaTeX / p5. Examples that ALL fit visual_html:
  - bias-variance tradeoff → a slider showing under/overfit on a curve
  - hash collisions → click to insert keys, watch buckets fill
  - eigenvectors → drag a vector, see which lines stay invariant
  - softmax → input slider, output bars
  - any algorithm → step-by-step animated state
  - any formula → live re-evaluation when you change inputs

- **video_manim**: ONLY when motion-over-time IS the insight and a learner can't manipulate it themselves. E.g. visualizing the unfolding of an integral, a Fourier decomposition forming a square wave, a recursive call stack unwinding. The user wrote "show / animate / visualize / how does X move / draw" → strongly biases here.

- **text**: ONLY when the concept is purely linguistic, historical, philosophical, or has no plausible visual element. Examples that DO warrant text: "Who was Turing?", "What does NP-complete mean as a definition?", "Etymology of the word algorithm." This should be rare — under 10% of highlights.

If you find yourself reaching for text because "the concept is conceptual," ask: could a slider, a clickable diagram, or an animated state machine make this idea click faster? If yes → visual_html.

Call route_lesson once. The intent is one sentence the Planner will expand on.`;

export async function runRouter(input: OrchestrateInput, emit: EmitFn): Promise<{ mode: LessonMode; intent: string; reason: string }> {
  const trace = startTrace('router', 'Pick lesson type', FAST_MODEL);
  emit(trace);

  if (input.force) {
    finishTrace(trace, {
      status: 'done',
      preview: `forced: ${input.force}`,
      detail: `User explicitly requested ${input.force}`,
      tokensIn: 0, tokensOut: 0,
    });
    emit(trace);
    return { mode: input.force, intent: input.question || input.text.slice(0, 120), reason: 'user-forced' };
  }

  const userMsg = [
    input.docSummary ? `Document summary:\n${input.docSummary}` : null,
    input.recentLessons?.length ? `Recently explored concepts:\n${input.recentLessons.map(r => `- ${r.title}`).join('\n')}` : null,
    input.parentTitle ? `Parent concept: ${input.parentTitle}` : null,
    `Highlighted text:\n"""${input.text}"""`,
    input.question ? `User's question: ${input.question}` : 'No specific question.',
    'Pick the best mode for this lesson.',
  ].filter(Boolean).join('\n\n');

  try {
    const completion = await client.messages.create({
      model: FAST_MODEL,
      system: [{ type: 'text', text: ROUTER_SYSTEM, cache_control: { type: 'ephemeral' } }],
      max_tokens: 512,
      tools: [ROUTER_TOOL],
      tool_choice: { type: 'tool', name: 'route_lesson' },
      messages: [{ role: 'user', content: userMsg }],
    });
    const tool = findToolUse<{ mode: LessonMode; intent: string; reason: string }>(completion, 'route_lesson');
    if (!tool) throw new Error('Router did not return a route_lesson call');
    const tk = tokensFromUsage(completion.usage);
    finishTrace(trace, {
      preview: `${tool.mode} — ${tool.reason}`,
      detail: `intent: ${tool.intent}\nreason: ${tool.reason}`,
      tokensIn: tk.in, tokensOut: tk.out, cacheReadTokens: tk.cacheRead,
    });
    emit(trace);
    return tool;
  } catch (err) {
    finishTrace(trace, { status: 'error', error: (err as Error).message });
    emit(trace);
    throw err;
  }
}

export function runRetriever(input: OrchestrateInput, emit: EmitFn): RetrievedChunk[] {
  const trace = startTrace('retriever', 'Retrieve grounding chunks', 'BM25 (local)');
  emit(trace);
  if (!input.docId) {
    finishTrace(trace, {
      status: 'skipped',
      preview: 'no docId — skipped',
      detail: 'PDF was not indexed; falling back to docSummary only.',
    });
    emit(trace);
    return [];
  }
  try {
    const query = `${input.text} ${input.question ?? ''}`.trim();
    const chunks = retrieve(input.docId, query, 4);
    finishTrace(trace, {
      preview: chunks.length ? `top ${chunks.length} chunks (max BM25 = ${chunks[0].score.toFixed(2)})` : 'no relevant chunks found',
      detail: chunks.map((c, i) => `#${i + 1} score=${c.score.toFixed(2)} chunkId=${c.chunkId}\n${c.text.slice(0, 240)}…`).join('\n\n'),
    });
    emit(trace);
    return chunks;
  } catch (err) {
    finishTrace(trace, { status: 'error', error: (err as Error).message });
    emit(trace);
    return [];
  }
}

const PLANNER_TOOL = {
  name: 'emit_plan',
  description: 'Emit a pedagogical plan for the chosen lesson type.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Concept title, ≤ 60 chars.' },
      summary: { type: 'string', description: 'One-sentence preview, ≤ 140 chars.' },
      beats: {
        type: 'array',
        description: '3–5 ordered teaching beats. Each beat is one micro-step in the lesson.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Short beat label (≤ 32 chars).' },
            intent: { type: 'string', description: 'What this beat teaches and how the learner gains intuition.' },
            viz: { type: 'string', description: 'For visual_html / video_manim only: a concrete visual idea for this beat.' },
          },
          required: ['label', 'intent'],
        },
      },
      approach: {
        type: 'string',
        description: 'A 1–2 sentence rationale for why this beat structure works pedagogically.',
      },
      prerequisites: {
        type: 'array',
        description: 'Up to 2 concepts the lesson assumes the learner knows. Empty if the concept is self-contained.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            brief: { type: 'string' },
          },
          required: ['title', 'brief'],
        },
      },
      manim_brief: {
        type: 'string',
        description: 'For video_manim only: 2–4 sentences describing exactly what the animation should show, in pedagogical order. Required for video_manim, omit otherwise.',
      },
    },
    required: ['title', 'summary', 'beats', 'approach'],
  },
};

const PLANNER_SYSTEM = `You are a pedagogical planner. Given a chosen lesson mode plus retrieved document context, emit a structured plan a downstream Author will turn into the lesson.

PHILOSOPHY for visual_html: the viz IS the lesson. Don't over-decompose. 2–3 beats is usually right; sometimes ONE beat (the viz itself + a tight explanation) is enough.

Your job:
1. Title (≤ 60 chars) and one-sentence summary (≤ 140 chars).
2. 2–4 ordered teaching beats. Each beat: short label + one-sentence intent.
   - For visual_html: each beat needs a viz idea (what the learner sees / manipulates). The first beat should describe THE centerpiece interactive widget.
   - For video_manim: each beat is a scene-beat with a viz idea.
   - For text: skip the viz field entirely.
3. Up to 2 genuine prerequisites the learner might lack. Empty array if self-contained — most concepts are.
4. Approach: 1 sentence on why this structure works.
5. video_manim ONLY: manim_brief — 2–3 sentences describing what the animation shows, in order.

GROUNDING:
- Document summary anchors domain. Retrieved chunks are verbatim passages — be consistent with them.
- If recently-explored concepts are listed, build on them when natural.

Be concrete and BRIEF. The plan is scaffolding for ONE focused interactive demo, not a chapter outline. Call emit_plan once.`;

export async function runPlanner(
  input: OrchestrateInput,
  mode: LessonMode,
  intent: string,
  chunks: RetrievedChunk[],
  emit: EmitFn,
): Promise<PlannerOutput> {
  // Use Haiku for the simpler text-mode plan (no viz, no manim_brief).
  const plannerModel = mode === 'text' ? FAST_MODEL : MAIN_MODEL;
  const trace = startTrace('planner', 'Plan teaching beats', plannerModel);
  emit(trace);

  const userMsg = [
    input.docSummary ? `Document summary:\n${input.docSummary}` : null,
    chunks.length ? `Retrieved passages from the document (BM25 top-${chunks.length}):\n${chunks.map((c, i) => `[${i + 1}] (score=${c.score.toFixed(2)})\n${c.text}`).join('\n\n')}` : null,
    input.recentLessons?.length ? `Recently explored:\n${input.recentLessons.map(r => `- ${r.title}`).join('\n')}` : null,
    input.parentTitle ? `Parent concept: ${input.parentTitle}` : null,
    `Mode: ${mode}`,
    `Intent (from router): ${intent}`,
    `Highlighted text:\n"""${input.text}"""`,
    input.question ? `User question: ${input.question}` : null,
    'Emit the plan now.',
  ].filter(Boolean).join('\n\n');

  try {
    const completion = await client.messages.create({
      model: plannerModel,
      system: [{ type: 'text', text: PLANNER_SYSTEM, cache_control: { type: 'ephemeral' } }],
      max_tokens: 1024,
      tools: [PLANNER_TOOL],
      tool_choice: { type: 'tool', name: 'emit_plan' },
      messages: [{ role: 'user', content: userMsg }],
    });
    const tool = findToolUse<PlannerOutput>(completion, 'emit_plan');
    if (!tool) throw new Error('Planner did not return emit_plan');
    const tk = tokensFromUsage(completion.usage);
    finishTrace(trace, {
      preview: `${tool.beats.length} beats — "${tool.title}"`,
      detail: `${tool.approach}\n\n` + tool.beats.map((b, i) => `${i + 1}. ${b.label} — ${b.intent}${b.viz ? `\n   viz: ${b.viz}` : ''}`).join('\n'),
      tokensIn: tk.in, tokensOut: tk.out, cacheReadTokens: tk.cacheRead,
    });
    emit(trace);
    return tool;
  } catch (err) {
    finishTrace(trace, { status: 'error', error: (err as Error).message });
    emit(trace);
    throw err;
  }
}

const AUTHOR_TOOL = {
  name: 'emit_content',
  description: 'Emit the final lesson HTML/CSS/JS body for the given plan.',
  input_schema: {
    type: 'object' as const,
    properties: {
      html: { type: 'string', description: 'Body HTML, no <html>/<head>/<body> tags.' },
      css: { type: 'string', description: 'CSS only.' },
      js: { type: 'string', description: 'Vanilla JS only, no <script> tags. Empty string for pure-text lessons.' },
    },
    required: ['html', 'css', 'js'],
  },
};

const AUTHOR_TEXT_SYSTEM = `You write the prose body of a text-mode lesson. The Planner has chosen the title, summary, and beats. Convert the plan into clean semantic HTML.

OUTPUT via emit_content:
- html: body fragment ONLY. Use <h2> for beat labels, <p> for prose, <ul>/<ol> where needed, <strong>/<em> for emphasis. NO <h1> (the parent owns the title).
- css: empty string OR a few lines of small overrides. Do NOT re-style the page — the iframe shell already provides typography, max-width, code blocks, and dark theme. Adding > 30 lines of CSS is wrong for text mode.
- js: empty string. Pure prose lessons run no JavaScript.

For math: use $...$ inline and $$...$$ display. KaTeX auto-renders.

CONTENT RULES:
- One <h2> per beat from the plan, in order.
- 1–3 short paragraphs per beat. Be concise and load-bearing — every sentence should teach.
- Avoid filler ("In this section we will explore…"). Get to the point.
- Total length: aim for 400–800 words of body text, not more.

Call emit_content once.`;

const AUTHOR_VISUAL_SYSTEM = `You write the body of an interactive visual_html lesson. The viz IS the lesson. Prose is supporting context, not the centerpiece.

PHILOSOPHY:
- ONE great interactive widget that demonstrates the core idea > five mediocre static diagrams.
- The user should be able to GRAB something (slider, drag handle, button) and see the concept change in real time. Watching is fine; manipulating is better.
- Total prose: 150–350 words MAX. Short setup, then the viz, then a one-paragraph "why this matters."
- Don't pad with definitions the user didn't ask for. They highlighted a specific concept — explain THAT.

OUTPUT via emit_content:
- html: body fragment only — no <html>/<head>/<body>/<style>/<script> tags.
- css: KEEP UNDER 800 CHARACTERS. The iframe shell already provides typography, max-width centering, dark theme, code blocks, and base button styles. Only add CSS that the specific viz NEEDS — usually just a few selectors for layout (e.g. \`.viz-row { display: flex; gap: 1rem }\`). Do NOT re-style headings, paragraphs, or the page background.
- js: vanilla JS only, no <script> tags. Aim under 4000 chars unless the simulation genuinely needs more.
- DO NOT redefine the title or summary; the parent already has them.

STRUCTURE (typical):
1. One <p> of setup (1–2 sentences).
2. The interactive widget (SVG/canvas with controls). This is the centerpiece.
3. One <p> below: "what this shows."
4. Optional: a final <p> with the formal definition or formula.
You don't need an <h2> per beat — the plan's beats are guidance, not a section template. Collapse them naturally.

LIBRARIES — prefer high-level, declarative APIs. Less code = fewer bugs and faster generation.

PRIMARY (use these first):
- **Plotly** (window.Plotly) — ALL charts: line, scatter, bar, heatmap, contour, surface, histogram, box. Built-in pan/zoom/hover/legend. One call: \`Plotly.newPlot(div, traces, layout, {responsive:true})\`. Update with \`Plotly.react(div, traces, layout)\`. Don't write D3 axis chains.
- **Tweakpane** (window.Tweakpane) — sliders / toggles / color pickers / numeric inputs. \`const pane = new Tweakpane.Pane({container}); pane.addBinding(state, 'lr', {min:0, max:1});\` Don't hand-style \`<input type="range">\`.
- **KaTeX** auto-render — \`$inline$\` and \`$$display$$\` math.

ESCAPE HATCHES (use only when Primary can't express it):
- D3 v7 (window.d3) — custom SVG, force-directed layouts, novel viz.
- p5.js v1.10 (window.p5) — canvas / creative coding / sketches.

WIDGETS — make them work:
- Render an initial state on load. Don't make the user click before they see anything.
- Hook events via the lib's API or \`addEventListener\`. (If using inline onclick, declare the function at top-level scope of the js field.)
- For Plotly use \`{responsive: true}\` — it auto-handles container sizing.
- Reset / restart button if the widget has state.

EXAMPLE — a learning-rate slider that updates a live plot of \`y = x² - lr·x\`:

\`\`\`html
<p class="setup">Drag the slider to see how learning rate scales the dip in the loss curve.</p>
<div class="viz-row">
  <div id="plot" style="height:340px"></div>
  <div id="ctrl"></div>
</div>
<p class="caption">As lr grows, the parabola shifts: the optimizer step gets bigger.</p>
\`\`\`

\`\`\`js
const state = { lr: 0.4 };
function curve() {
  const xs = []; const ys = [];
  for (let x = -2; x <= 2; x += 0.05) { xs.push(x); ys.push(x*x - state.lr*x); }
  return [{x: xs, y: ys, type: 'scatter', mode: 'lines', line: {color: '#818cf8', width: 3}}];
}
const layout = { paper_bgcolor: '#0a0a0d', plot_bgcolor: '#0a0a0d',
  font: {color: '#e5e5e5'}, margin: {t: 10, l: 40, r: 10, b: 30},
  xaxis: {gridcolor: '#222', zerolinecolor: '#444', title: 'x'},
  yaxis: {gridcolor: '#222', zerolinecolor: '#444', title: 'loss'} };
Plotly.newPlot('plot', curve(), layout, {responsive: true, displayModeBar: false});

const pane = new Tweakpane.Pane({container: document.getElementById('ctrl')});
pane.addBinding(state, 'lr', {min: 0, max: 2, step: 0.01, label: 'learning rate'})
    .on('change', () => Plotly.react('plot', curve(), layout));
\`\`\`

That's the entire interactive lesson. ~25 lines of JS, not 80. Match this density.

DESIGN:
- Dark palette. Backgrounds #0a0a0d / #0e0e12. Indigo accents #818cf8 / #6366f1. Secondary accents OK (amber #fbbf24, emerald #34d399, rose #f87171) for contrast inside viz.
- Max-width 720px content column. Generous whitespace. Rounded corners 8–12px. No emojis.
- Label axes. Use real numbers. Highlight the active state.

ACCURACY > comprehensiveness. A correct, simple, interactive demo of ONE specific aspect of the concept is the goal.

Call emit_content once.`;

export async function runAuthor(
  input: OrchestrateInput,
  mode: LessonMode,
  plan: PlannerOutput,
  chunks: RetrievedChunk[],
  emit: EmitFn,
  partialContent: PartialFn,
): Promise<AuthoredContent> {
  // Text-mode authoring is fundamentally token-bound (~hundreds of words of
  // prose); Sonnet's reasoning is overkill and Haiku is ~3-4x faster.
  // Visual lessons need Sonnet's spatial reasoning + accurate D3 code.
  const isText = mode === 'text';
  const authorModel = isText ? FAST_MODEL : MAIN_MODEL;
  const authorSystem = isText ? AUTHOR_TEXT_SYSTEM : AUTHOR_VISUAL_SYSTEM;
  const maxTokens = isText ? 3072 : 8192;
  const trace = startTrace('author', 'Write lesson body', authorModel);
  emit(trace);

  const userMsg = [
    input.docSummary ? `Document summary:\n${input.docSummary}` : null,
    chunks.length ? `Document passages:\n${chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n')}` : null,
    `Mode: ${mode}`,
    `Plan title: ${plan.title}`,
    `Plan summary: ${plan.summary}`,
    `Approach: ${plan.approach}`,
    'Beats:\n' + plan.beats.map((b, i) => `${i + 1}. ${b.label} — ${b.intent}${b.viz ? `\n   viz: ${b.viz}` : ''}`).join('\n'),
    `Highlighted text:\n"""${input.text}"""`,
    input.question ? `User question: ${input.question}` : null,
    'Write the lesson body now. Each beat = one section. Call emit_content exactly once.',
  ].filter(Boolean).join('\n\n');

  try {
    const stream = client.messages.stream({
      model: authorModel,
      system: [{ type: 'text', text: authorSystem, cache_control: { type: 'ephemeral' } }],
      max_tokens: maxTokens,
      tools: [AUTHOR_TOOL],
      tool_choice: { type: 'tool', name: 'emit_content' },
      messages: [{ role: 'user', content: userMsg }],
    });

    let lastEmittedJson = '';
    stream.on('inputJson', (_partial: string, snapshot: unknown) => {
      const acc = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot ?? '');
      // Throttle so we don't re-render the iframe on every byte; 48 chars
      // gives a smooth perceptual stream without thrashing the parser.
      if (acc.length - lastEmittedJson.length < 48) return;
      lastEmittedJson = acc;
      try {
        const parsed = partialParse(acc, Allow.ALL) as Partial<AuthoredContent>;
        partialContent({ html: parsed.html, css: parsed.css });
      } catch { /* ignore */ }
    });

    const final = await stream.finalMessage();
    const tool = findToolUse<AuthoredContent>(final, 'emit_content');
    if (!tool) throw new Error('Author did not return emit_content');
    const tk = tokensFromUsage(final.usage);
    finishTrace(trace, {
      preview: `${(tool.html || '').length} chars HTML · ${(tool.css || '').length} chars CSS · ${(tool.js || '').length} chars JS`,
      detail: `Generated ${plan.beats.length}-beat lesson body.`,
      tokensIn: tk.in, tokensOut: tk.out, cacheReadTokens: tk.cacheRead,
    });
    emit(trace);
    return {
      html: tool.html || '',
      css: tool.css || '',
      js: tool.js || '',
    };
  } catch (err) {
    finishTrace(trace, { status: 'error', error: (err as Error).message });
    emit(trace);
    throw err;
  }
}

const CRITIC_TOOL = {
  name: 'critique_lesson',
  description: 'Review the authored lesson against the plan and the source.',
  input_schema: {
    type: 'object' as const,
    properties: {
      ok: { type: 'boolean', description: 'true = lesson is acceptable, false = needs refinement.' },
      severity: { type: 'string', enum: ['none', 'minor', 'major'] },
      issues: {
        type: 'array',
        description: 'Specific, actionable issues. Empty if ok.',
        items: { type: 'string' },
      },
      praise: {
        type: 'string',
        description: 'One sentence on what the lesson does well (always include).',
      },
    },
    required: ['ok', 'severity', 'issues', 'praise'],
  },
};

const CRITIC_SYSTEM = `You are a strict pedagogical reviewer. The Planner produced a plan; the Author produced a lesson body. Your job is to flag concrete issues.

Review for:
1. Pedagogical fit — does each beat in the plan show up clearly in the lesson?
2. Accuracy — does anything contradict the document or established knowledge?
3. Visualization quality (visual_html only) — is the viz actually informative, or decorative?
4. Functional correctness (visual_html only) — does the JS reference selectors that exist? Does it leave the user in a broken state? Are inline onclick handlers defined as global functions in js?
5. Tone and clarity — is it clear? Concise? Free of filler?

Be strict but specific. Don't say "could be improved" — say what to change. If the lesson is acceptable, return ok=true with severity="none" and an empty issues array. Reserve "major" for outright bugs or factual errors.

Call critique_lesson exactly once.`;

export interface CriticOutput {
  ok: boolean;
  severity: 'none' | 'minor' | 'major';
  issues: string[];
  praise: string;
}

export async function runCritic(
  plan: PlannerOutput,
  content: AuthoredContent,
  mode: LessonMode,
  emit: EmitFn,
): Promise<CriticOutput> {
  const trace = startTrace('critic', 'Review lesson against plan', FAST_MODEL);
  emit(trace);
  const userMsg = [
    `Mode: ${mode}`,
    `Plan title: ${plan.title}`,
    `Approach: ${plan.approach}`,
    'Beats:\n' + plan.beats.map((b, i) => `${i + 1}. ${b.label} — ${b.intent}${b.viz ? `\n   viz: ${b.viz}` : ''}`).join('\n'),
    `\nLesson HTML (first 4000 chars):\n${content.html.slice(0, 4000)}`,
    content.css ? `\nCSS (first 1500 chars):\n${content.css.slice(0, 1500)}` : '',
    content.js ? `\nJS (first 4000 chars):\n${content.js.slice(0, 4000)}` : '',
    '\nReview the lesson now. Be strict but specific.',
  ].filter(Boolean).join('\n');

  try {
    const completion = await client.messages.create({
      model: FAST_MODEL,
      system: [{ type: 'text', text: CRITIC_SYSTEM, cache_control: { type: 'ephemeral' } }],
      max_tokens: 1024,
      tools: [CRITIC_TOOL],
      tool_choice: { type: 'tool', name: 'critique_lesson' },
      messages: [{ role: 'user', content: userMsg }],
    });
    const tool = findToolUse<CriticOutput>(completion, 'critique_lesson');
    if (!tool) throw new Error('Critic did not return critique_lesson');
    const tk = tokensFromUsage(completion.usage);
    const verdict = tool.ok ? 'pass' : `${tool.severity} — ${tool.issues.length} issue(s)`;
    finishTrace(trace, {
      preview: verdict,
      detail: `${tool.praise}\n\n${tool.issues.length ? 'Issues:\n' + tool.issues.map((i) => `- ${i}`).join('\n') : 'No issues.'}`,
      tokensIn: tk.in, tokensOut: tk.out, cacheReadTokens: tk.cacheRead,
    });
    emit(trace);
    return tool;
  } catch (err) {
    finishTrace(trace, { status: 'error', error: (err as Error).message });
    emit(trace);
    return { ok: true, severity: 'none', issues: [], praise: 'Critic unavailable; treating as pass.' };
  }
}

const REFINER_SYSTEM = `You are a careful editor. The Author wrote a lesson; the Critic listed concrete issues. Your job is to fix every issue while preserving everything that already works.

CONSTRAINTS — same as the Author:
- Body HTML only, no <html>/<head>/<body> tags.
- CSS only, no <style>.
- Vanilla JS only, no <script> tags.
- Libraries available: D3 v7, KaTeX 0.16, p5.js v1.10.
- Dark theme: #0a0a0d / #0e0e12 backgrounds, indigo accents #818cf8 / #6366f1.
- Inline event handlers must be top-level functions in js.

Apply the fixes. Don't editorialize — emit the corrected emit_content directly.`;

export async function runRefiner(
  plan: PlannerOutput,
  content: AuthoredContent,
  critic: CriticOutput,
  mode: LessonMode,
  emit: EmitFn,
): Promise<AuthoredContent> {
  const trace = startTrace('refiner', 'Apply Critic fixes', MAIN_MODEL);
  emit(trace);
  const userMsg = [
    `Mode: ${mode}`,
    `Plan title: ${plan.title}`,
    `Issues to fix:\n${critic.issues.map((i) => `- ${i}`).join('\n')}`,
    `\nCurrent HTML:\n${content.html}`,
    `\nCurrent CSS:\n${content.css}`,
    `\nCurrent JS:\n${content.js}`,
    '\nEmit the corrected lesson via emit_content.',
  ].join('\n');
  try {
    const completion = await client.messages.create({
      model: MAIN_MODEL,
      system: [{ type: 'text', text: REFINER_SYSTEM, cache_control: { type: 'ephemeral' } }],
      max_tokens: 8192,
      tools: [AUTHOR_TOOL],
      tool_choice: { type: 'tool', name: 'emit_content' },
      messages: [{ role: 'user', content: userMsg }],
    });
    const tool = findToolUse<AuthoredContent>(completion, 'emit_content');
    if (!tool) throw new Error('Refiner did not return emit_content');
    const tk = tokensFromUsage(completion.usage);
    finishTrace(trace, {
      preview: `${critic.issues.length} fix(es) applied`,
      detail: `Issues addressed:\n${critic.issues.map((i) => `- ${i}`).join('\n')}`,
      tokensIn: tk.in, tokensOut: tk.out, cacheReadTokens: tk.cacheRead,
    });
    emit(trace);
    return {
      html: tool.html || content.html,
      css: tool.css || content.css,
      js: tool.js || content.js,
    };
  } catch (err) {
    finishTrace(trace, { status: 'error', error: (err as Error).message });
    emit(trace);
    return content;
  }
}

export function emitSkipped(name: AgentName, label: string, reason: string, emit: EmitFn) {
  const trace: AgentTrace = {
    id: nextId(),
    agent: name,
    label,
    status: 'skipped',
    startedAt: Date.now(),
    finishedAt: Date.now(),
    durationMs: 0,
    preview: reason,
  };
  emit(trace);
}
