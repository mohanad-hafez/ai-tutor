import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import path from 'path';
import { client, MAIN_MODEL, SUMMARY_MODEL, QUIZ_MODEL, findToolUse, parseJsonRelaxed, extractText } from './anthropic.js';
import { QUIZ_SYSTEM, SUMMARY_PROMPT } from './lessonPrompts.js';
import { createVideoJob, subscribe, streamVideo, cancelJob } from './video.js';
import { cacheKey, readCache, writeCache, semanticInsert } from './cache.js';
import { buildIndex } from './retriever.js';
import { warmupEmbeddings } from './embeddings.js';
import {
  runMemory, runRouter, runRetriever, runPlanner, runAuthor, runCritic, runRefiner, emitSkipped,
  type AgentTrace, type RecentLesson,
} from './agents.js';

// Pre-load the sentence-BERT model so the first user request doesn't pay
// the cold-start cost (~3s). Runs in the background; the orchestrator
// awaits the same promise on first use if it isn't ready yet.
void warmupEmbeddings().catch((err) => console.error('[embeddings] warmup failed:', err));

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' }));

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC_VIDEOS_DIR = path.join(REPO_ROOT, 'public', 'videos');

app.get('/videos/:file', (req, res) => {
  const file = req.params.file;
  if (!/^[\w-]+\.mp4$/.test(file)) {
    res.status(400).end();
    return;
  }
  streamVideo(path.join(PUBLIC_VIDEOS_DIR, file), res);
});

app.post('/api/summarize', async (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'text required' });
    return;
  }
  const trimmed = text.length > 80000 ? text.slice(0, 80000) : text;

  // Build the BM25 index up-front so future /api/explain calls can retrieve
  // grounded chunks instead of relying on the 200-word summary alone.
  const { docId, chunkCount } = buildIndex(trimmed);

  const key = cacheKey({ kind: 'summary', text: trimmed, model: SUMMARY_MODEL });
  const hit = await readCache<{ summary: string }>(key);
  if (hit) { res.json({ ...hit, docId, chunkCount }); return; }
  try {
    const completion = await client.messages.create({
      model: SUMMARY_MODEL,
      system: SUMMARY_PROMPT,
      max_tokens: 1024,
      messages: [{ role: 'user', content: trimmed }],
    });
    const out = { summary: extractText(completion).trim() };
    await writeCache(key, out);
    res.json({ ...out, docId, chunkCount });
  } catch (err) {
    console.error('summarize error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

interface LessonPrereq { title: string; brief: string }

function jsSyntaxError(js: string): string | null {
  if (!js || !js.trim()) return null;
  try {
    new Function(js);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

app.post('/api/explain', async (req, res) => {
  const { text, question, parentTitle, docSummary, docId, force, recentLessons } = req.body || {};
  if (!text) {
    res.status(400).json({ error: 'text required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const emitTrace = (t: AgentTrace) => send('agent_step', t);

  const recent: RecentLesson[] = Array.isArray(recentLessons) ? recentLessons.slice(0, 5) : [];

  // Cache short-circuit: skip the whole pipeline if we've seen this exact request.
  const key = cacheKey({ kind: 'explain', text, question, docSummary, parentTitle, force, model: MAIN_MODEL });
  const hit = await readCache<{
    mode: 'text' | 'visual_html' | 'video_manim';
    title: string;
    summary: string;
    content?: { html: string; css: string; js: string };
    manimBrief?: string;
    prerequisites?: LessonPrereq[];
  }>(key);
  if (hit) {
    if (hit.mode === 'video_manim') {
      const { jobId } = createVideoJob({
        text,
        question,
        docSummary,
        parentTitle,
        brief: hit.manimBrief || `${hit.title}. ${hit.summary}`,
      });
      send('complete', {
        mode: 'video_manim',
        title: hit.title,
        summary: hit.summary,
        jobId,
        prerequisites: hit.prerequisites || [],
        cached: true,
      });
    } else {
      send('complete', {
        mode: hit.mode,
        title: hit.title,
        summary: hit.summary,
        content: hit.content,
        prerequisites: hit.prerequisites || [],
        cached: true,
      });
    }
    res.end();
    return;
  }

  const orchInput = {
    text,
    question,
    parentTitle,
    docSummary,
    docId,
    recentLessons: recent,
    force,
  };

  try {
    // 0. Memory — semantic dedup. Either redirect to an existing frame,
    //    reuse a semantically-similar prior generation, or fall through
    //    to the full pipeline. Returns the query embedding regardless so
    //    we can persist it after the lesson completes.
    const memory = await runMemory(orchInput, emitTrace);
    if (memory.kind === 'redirect') {
      // No new lesson — frontend focuses the existing frame.
      send('complete', {
        mode: 'redirect',
        redirectFrameId: memory.frameId,
        matchTitle: memory.matchTitle,
        score: memory.score,
      });
      res.end();
      return;
    }
    if (memory.kind === 'semantic_hit') {
      // Reuse the prior cached generation.
      const cached = await readCache<{
        mode: 'text' | 'visual_html' | 'video_manim';
        title: string;
        summary: string;
        content?: { html: string; css: string; js: string };
        manimBrief?: string;
        prerequisites?: LessonPrereq[];
      }>(memory.cacheKey);
      if (cached) {
        if (cached.mode === 'video_manim') {
          const { jobId } = createVideoJob({
            text,
            question,
            docSummary,
            parentTitle,
            brief: cached.manimBrief || `${cached.title}. ${cached.summary}`,
          });
          send('complete', {
            mode: 'video_manim',
            title: cached.title,
            summary: cached.summary,
            jobId,
            prerequisites: cached.prerequisites || [],
            semanticHit: { matchedQuery: memory.matchedQuery, score: memory.score },
          });
        } else {
          send('complete', {
            mode: cached.mode,
            title: cached.title,
            summary: cached.summary,
            content: cached.content,
            prerequisites: cached.prerequisites || [],
            semanticHit: { matchedQuery: memory.matchedQuery, score: memory.score },
          });
        }
        res.end();
        return;
      }
      // Cached entry missing on disk — fall through to full pipeline.
    }

    // 1. Router — pick mode + intent
    const route = await runRouter(orchInput, emitTrace);

    // 2. Retriever — BM25 chunks (no LLM)
    const chunks = runRetriever(orchInput, emitTrace);

    // 3. Planner — pedagogical plan
    const plan = await runPlanner(orchInput, route.mode, route.intent, chunks, emitTrace);
    // Surface the plan-level title/summary/prereqs to the client immediately
    send('partial', {
      mode: route.mode,
      title: plan.title,
      summary: plan.summary,
      prerequisites: plan.prerequisites ?? [],
    });

    // Branch: video_manim hands off to the dedicated video pipeline.
    if (route.mode === 'video_manim') {
      emitSkipped('author', 'Write lesson body', 'video mode — handled by manim pipeline', emitTrace);
      emitSkipped('critic', 'Review lesson against plan', 'video mode', emitTrace);
      emitSkipped('refiner', 'Apply Critic fixes', 'video mode', emitTrace);

      const brief = plan.manim_brief || `${plan.title}. ${plan.summary}`;
      await writeCache(key, {
        mode: 'video_manim',
        title: plan.title,
        summary: plan.summary,
        manimBrief: brief,
        prerequisites: plan.prerequisites ?? [],
      });
      // Persist into the semantic index so paraphrases of this concept reuse it.
      await semanticInsert(key, `${text} ${question ?? ''}`.trim(), memory.embedding);
      const { jobId } = createVideoJob({
        text,
        question,
        docSummary,
        parentTitle,
        brief,
      });
      send('complete', {
        mode: 'video_manim',
        title: plan.title,
        summary: plan.summary,
        prerequisites: plan.prerequisites ?? [],
        jobId,
      });
      res.end();
      return;
    }

    // 4. Author — write the body (streams partial HTML/CSS to the client)
    const authored = await runAuthor(
      orchInput,
      route.mode,
      plan,
      chunks,
      emitTrace,
      (p) => send('partial', { mode: route.mode, ...p }),
    );

    // Server-side JS syntax gate (deterministic — runs before Critic)
    let content = authored;
    const synErr = jsSyntaxError(content.js);
    if (synErr) {
      const repairTrace: AgentTrace = {
        id: `step_synfix_${Math.random().toString(36).slice(2, 8)}`,
        agent: 'refiner',
        label: 'Fix JS syntax',
        status: 'running',
        startedAt: Date.now(),
      };
      send('agent_step', repairTrace);
      const fixed = await runRefiner(
        plan,
        content,
        { ok: false, severity: 'major', issues: [`Fix JS syntax error: ${synErr}`], praise: '' },
        route.mode,
        emitTrace,
      );
      content = fixed;
    }

    // 5. Critic — review against the plan. Off by default because it adds
    //    ~10s plus a full Refiner pass (~30s) on every visual_html lesson,
    //    nearly doubling wall-clock. The deterministic JS-syntax gate above
    //    already catches the worst breakage. Set CRITIC=on to enable for
    //    quality-tuned demos.
    const criticEnabled = process.env.CRITIC === 'on';
    let finalContent = content;
    if (route.mode === 'text') {
      emitSkipped('critic', 'Review lesson against plan', 'text mode — skipped', emitTrace);
      emitSkipped('refiner', 'Apply Critic fixes', 'no critic — nothing to refine', emitTrace);
    } else if (!criticEnabled) {
      emitSkipped('critic', 'Review lesson against plan', 'disabled (set CRITIC=on)', emitTrace);
      emitSkipped('refiner', 'Apply Critic fixes', 'critic disabled', emitTrace);
    } else {
      const critique = await runCritic(plan, content, route.mode, emitTrace);
      // 6. Refiner — only if critic flagged something serious
      if (!critique.ok && critique.severity === 'major' && critique.issues.length > 0) {
        finalContent = await runRefiner(plan, content, critique, route.mode, emitTrace);
      } else {
        emitSkipped('refiner', 'Apply Critic fixes', critique.ok ? 'critic passed — no fix needed' : 'minor issues only — skipped', emitTrace);
      }
    }

    await writeCache(key, {
      mode: route.mode,
      title: plan.title,
      summary: plan.summary,
      content: finalContent,
      prerequisites: plan.prerequisites ?? [],
    });
    // Persist into the semantic index so paraphrases of this concept reuse it.
    await semanticInsert(key, `${text} ${question ?? ''}`.trim(), memory.embedding);
    send('complete', {
      mode: route.mode,
      title: plan.title,
      summary: plan.summary,
      content: finalContent,
      prerequisites: plan.prerequisites ?? [],
    });
    res.end();
  } catch (err) {
    console.error('explain error:', err);
    send('error', { message: (err as Error).message || 'generation failed' });
    res.end();
  }
});

app.post('/api/quiz', async (req, res) => {
  const { title, summary, sourceText, docSummary } = req.body || {};
  const userMsg = [
    docSummary ? `DOCUMENT SUMMARY:\n${docSummary}` : null,
    `Concept: ${title}`,
    `Summary: ${summary}`,
    sourceText ? `Source text: ${sourceText}` : null,
    `Generate the interactive dark-mode quiz now.`,
  ].filter(Boolean).join('\n\n');

  const key = cacheKey({ kind: 'quiz', title, summary, text: sourceText, docSummary, model: QUIZ_MODEL });
  const hit = await readCache<{ mode: 'visual_html'; title: string; summary: string; content: { html: string; css: string; js: string } }>(key);
  if (hit) { res.json(hit); return; }

  try {
    const completion = await client.messages.create({
      model: QUIZ_MODEL,
      system: [
        { type: 'text', text: QUIZ_SYSTEM, cache_control: { type: 'ephemeral' } },
      ],
      max_tokens: 8192,
      messages: [{ role: 'user', content: userMsg }],
    });
    const raw = extractText(completion) || '{}';
    const parsed = parseJsonRelaxed<{ title?: string; summary?: string; html?: string; css?: string; js?: string }>(raw);
    const out = {
      mode: 'visual_html' as const,
      title: parsed.title || 'Quiz',
      summary: parsed.summary || '',
      content: {
        html: parsed.html || '',
        css: parsed.css || '',
        js: parsed.js || '',
      },
    };
    await writeCache(key, out);
    res.json(out);
  } catch (err) {
    console.error('quiz error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * Chat endpoint — used by the prompt bar under video frames so the user can
 * ask follow-ups about an animation without spawning a new lesson. Pure-text
 * streaming response, no tools, conversational tone. Conditioned on the video
 * brief, chapter labels, and prior chat history so answers reference what the
 * user just watched.
 */
app.post('/api/chat', async (req, res) => {
  const { contextTitle, contextSummary, videoBrief, videoChapters, docSummary, history, question } = req.body || {};
  if (!question || typeof question !== 'string') {
    res.status(400).json({ error: 'question required' });
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const system = `You answer follow-up questions about an animation the learner just watched. Be conversational, accurate, and brief — usually 1–4 short paragraphs. Reference the video naturally when it helps ("In the animation you saw..."). When math is needed, use \\( inline \\) or $$ display $$ for KaTeX.

If the question is off-topic from the animation, redirect briefly and offer to make a new lesson on the side topic.`;

  const ctx = [
    docSummary ? `Document context:\n${docSummary}` : null,
    contextTitle ? `Animation title: ${contextTitle}` : null,
    contextSummary ? `Animation summary: ${contextSummary}` : null,
    videoBrief ? `Animation brief (what the video shows):\n${videoBrief}` : null,
    Array.isArray(videoChapters) && videoChapters.length
      ? `Chapter timestamps:\n${videoChapters.map((c: { t: number; label: string }) => `  ${c.t}s — ${c.label}`).join('\n')}`
      : null,
  ].filter(Boolean).join('\n\n');

  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  if (ctx) {
    messages.push({ role: 'user', content: ctx });
    messages.push({ role: 'assistant', content: 'Got it. I have the animation context — ask away.' });
  }
  if (Array.isArray(history)) {
    for (const m of history) {
      if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string') {
        messages.push({ role: m.role, content: m.text });
      }
    }
  }
  messages.push({ role: 'user', content: question });

  try {
    const stream = client.messages.stream({
      model: QUIZ_MODEL, // Haiku — chat answers don't need Sonnet's reasoning depth
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      max_tokens: 1024,
      messages,
    });
    stream.on('text', (delta: string) => send('delta', { text: delta }));
    await stream.finalMessage();
    send('done', {});
    res.end();
  } catch (err) {
    console.error('chat error:', err);
    send('error', { message: (err as Error).message });
    res.end();
  }
});

app.post('/api/video', (req, res) => {
  const { text, question, docSummary, parentTitle, brief } = req.body || {};
  if (!text && !brief) {
    res.status(400).json({ error: 'text or brief required' });
    return;
  }
  const { jobId } = createVideoJob({ text: text || brief, question, docSummary, parentTitle, brief });
  res.json({ jobId });
});

app.get('/api/video/:jobId/events', (req, res) => {
  subscribe(req.params.jobId, res);
});

app.delete('/api/video/:jobId', (req, res) => {
  const ok = cancelJob(req.params.jobId);
  res.status(ok ? 200 : 404).json({ ok });
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, '127.0.0.1', () => console.log(`tutor server on :${PORT}`));
