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

export type AgentName =
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

export interface RecentLesson { title: string; sourceText?: string }

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

const ROUTER_SYSTEM = `You route a learner's highlight to the best lesson type. Choose ONE:
- text: pure prose. Conceptual, definitional, reasoning-heavy. No motion, no manipulation.
- visual_html: interactive HTML/CSS/JS using D3/KaTeX/p5. Spatial / structural / step-state concepts (trees, hash tables, projections, geometric intuition).
- video_manim: a short narrated Manim animation. Choose when motion-over-time is the core insight (gradient descent, rotations, sorting, signal transforms).

Cues:
- User words like "show / animate / visualize / draw / how does X move" → video_manim.
- "What is / why / explain" without motion language and concept is conceptual → text.
- Discrete elements to manipulate or visualize structurally → visual_html.

Call route_lesson exactly once. Be decisive. The intent is one sentence the downstream Planner will expand on.`;

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

const PLANNER_SYSTEM = `You are a pedagogical planner. Given a chosen lesson mode (text / visual_html / video_manim) plus retrieved document context, you emit a structured plan that a downstream Author agent will turn into the actual lesson.

Your job is to:
1. Identify the title and one-sentence summary.
2. Decompose the concept into 3–5 ordered teaching beats. Each beat is a micro-lesson on its own and they MUST build on each other.
3. For visual_html and video_manim, every beat needs a concrete viz idea (what the learner sees, not just what they're told).
4. List up to 2 genuine prerequisites the learner might lack. Empty array if the concept is self-contained.
5. Explain the approach in 1–2 sentences — why this structure teaches it.
6. For video_manim ONLY: write a manim_brief — 2–4 sentences describing what the Manim animation should show, in pedagogical order. The video pipeline turns this into a Scene.

GROUNDING:
- Document summary anchors the domain.
- Retrieved chunks are verbatim passages from the document. Cite them implicitly — your plan should be consistent with what the document actually says.
- If recently-explored concepts are listed, build on them when natural ("you've already seen X; this extends it to Y").

Be concrete. Avoid generic advice like "use diagrams" — say what the diagram shows.

Call emit_plan exactly once.`;

export async function runPlanner(
  input: OrchestrateInput,
  mode: LessonMode,
  intent: string,
  chunks: RetrievedChunk[],
  emit: EmitFn,
): Promise<PlannerOutput> {
  const trace = startTrace('planner', 'Plan teaching beats', MAIN_MODEL);
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
      model: MAIN_MODEL,
      system: [{ type: 'text', text: PLANNER_SYSTEM, cache_control: { type: 'ephemeral' } }],
      max_tokens: 2048,
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

const AUTHOR_SYSTEM = `You are an elite tutor writing the final body of a lesson. The Planner has already chosen the title, summary, beats, and approach. Your only job is to turn the plan into beautiful, accurate, dark-mode HTML/CSS/JS.

CONSTRAINTS:
- Output via the emit_content tool.
- html: body fragment only — no <html>/<head>/<body>/<style>/<script> tags.
- css: styles only.
- js: vanilla JS only, no <script> tags. For 'text' mode, leave js as an empty string.
- DO NOT redefine the title or summary; the parent already has them.
- Each beat in the plan should map to a section in the lesson. Use semantic HTML (h2 for beats, p for prose, ul/ol where appropriate).

LIBRARIES AVAILABLE in the iframe runtime:
- D3 v7 (window.d3)
- KaTeX 0.16 with auto-render — use $...$ for inline math, $$...$$ for display
- p5.js v1.10 (window.p5)

DESIGN:
- Dark palette. Backgrounds #0a0a0d / #0e0e12. Indigo accents #818cf8 / #6366f1.
- Generous whitespace. Max-width 720px content column. Line-height 1.6.
- Rounded corners 8–12px. No emojis. No harsh contrasts.
- Visualizations must be ACCURATE. Label axes. Use real numbers where they matter.
- For interactive widgets: name buttons clearly. Provide reset functionality. Don't leave the user stuck.

If you write inline event handlers like onclick="foo()", make sure foo is declared at top-level scope in the js field.`;

export async function runAuthor(
  input: OrchestrateInput,
  mode: LessonMode,
  plan: PlannerOutput,
  chunks: RetrievedChunk[],
  emit: EmitFn,
  partialContent: PartialFn,
): Promise<AuthoredContent> {
  const trace = startTrace('author', 'Write lesson body', MAIN_MODEL);
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
      model: MAIN_MODEL,
      system: [{ type: 'text', text: AUTHOR_SYSTEM, cache_control: { type: 'ephemeral' } }],
      max_tokens: 8192,
      tools: [AUTHOR_TOOL],
      tool_choice: { type: 'tool', name: 'emit_content' },
      messages: [{ role: 'user', content: userMsg }],
    });

    let lastEmittedJson = '';
    stream.on('inputJson', (_partial: string, snapshot: unknown) => {
      const acc = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot ?? '');
      if (acc.length - lastEmittedJson.length < 96) return;
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
