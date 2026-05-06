import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import path from 'path';
import { client, MAIN_MODEL, SUMMARY_MODEL, QUIZ_MODEL, findToolUse, parseJsonRelaxed, extractText } from './anthropic.js';
import { LESSON_SYSTEM, LESSON_TOOL, QUIZ_SYSTEM, SUMMARY_PROMPT } from './lessonPrompts.js';
import { createVideoJob, subscribe, streamVideo, cancelJob } from './video.js';
import { cacheKey, readCache, writeCache } from './cache.js';
import { parse as partialParse, Allow } from 'partial-json';

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
  const key = cacheKey({ kind: 'summary', text: trimmed, model: SUMMARY_MODEL });
  const hit = await readCache<{ summary: string }>(key);
  if (hit) { res.json(hit); return; }
  try {
    const completion = await client.messages.create({
      model: SUMMARY_MODEL,
      system: SUMMARY_PROMPT,
      max_tokens: 1024,
      messages: [{ role: 'user', content: trimmed }],
    });
    const out = { summary: extractText(completion).trim() };
    await writeCache(key, out);
    res.json(out);
  } catch (err) {
    console.error('summarize error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

interface LessonPrereq { title: string; brief: string }

interface LessonToolInput {
  mode: 'text' | 'visual_html' | 'video_manim';
  title: string;
  summary: string;
  html?: string;
  css?: string;
  js?: string;
  manim_brief?: string;
  prerequisites?: LessonPrereq[];
}

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
  const { text, question, parentTitle, docSummary, force } = req.body || {};
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
      });
    } else {
      send('complete', {
        mode: hit.mode,
        title: hit.title,
        summary: hit.summary,
        content: hit.content,
        prerequisites: hit.prerequisites || [],
      });
    }
    res.end();
    return;
  }

  const userMsg = buildExplainUserMsg({ text, question, parentTitle, docSummary, force });

  try {
    const stream = client.messages.stream({
      model: MAIN_MODEL,
      system: [{ type: 'text', text: LESSON_SYSTEM, cache_control: { type: 'ephemeral' } }],
      max_tokens: 8192,
      tools: [LESSON_TOOL],
      tool_choice: { type: 'tool', name: 'emit_lesson' },
      messages: [{ role: 'user', content: userMsg }],
    });

    let lastEmittedJson = '';
    stream.on('inputJson', (_partial: string, snapshot: unknown) => {
      const acc = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot ?? '');
      // Throttle: only emit when the snapshot grew by ≥ 64 chars
      if (acc.length - lastEmittedJson.length < 64) return;
      lastEmittedJson = acc;
      try {
        const parsed = partialParse(acc, Allow.ALL);
        send('partial', parsed);
      } catch { /* not yet parseable */ }
    });

    const final = await stream.finalMessage();
    let tool = findToolUse<LessonToolInput>(final, 'emit_lesson');
    if (!tool) {
      send('error', { message: 'Model did not call emit_lesson' });
      res.end();
      return;
    }

    if (tool.mode === 'visual_html' && tool.js) {
      const synErr = jsSyntaxError(tool.js);
      if (synErr) {
        send('partial', { _repair: true, message: 'Repairing script…' });
        const repairMsg = `${userMsg}\n\nA previous attempt produced JavaScript with this syntax error: ${synErr}\n\nPrevious JS:\n\`\`\`js\n${tool.js}\n\`\`\`\n\nProduce a corrected emit_lesson with the same teaching intent and clean JS.`;
        const repair = await client.messages.create({
          model: MAIN_MODEL,
          system: [{ type: 'text', text: LESSON_SYSTEM, cache_control: { type: 'ephemeral' } }],
          max_tokens: 8192,
          tools: [LESSON_TOOL],
          tool_choice: { type: 'tool', name: 'emit_lesson' },
          messages: [{ role: 'user', content: repairMsg }],
        });
        const fixed = findToolUse<LessonToolInput>(repair, 'emit_lesson');
        if (fixed) tool = fixed;
      }
    }

    if (tool.mode === 'video_manim') {
      await writeCache(key, {
        mode: 'video_manim',
        title: tool.title || 'Lesson',
        summary: tool.summary || '',
        manimBrief: tool.manim_brief || `${tool.title}. ${tool.summary}`,
        prerequisites: tool.prerequisites || [],
      });
      const { jobId } = createVideoJob({
        text,
        question,
        docSummary,
        parentTitle,
        brief: tool.manim_brief || `${tool.title}. ${tool.summary}`,
      });
      send('complete', {
        mode: 'video_manim',
        title: tool.title || 'Lesson',
        summary: tool.summary || '',
        prerequisites: tool.prerequisites || [],
        jobId,
      });
      res.end();
      return;
    }

    const content = { html: tool.html || '', css: tool.css || '', js: tool.js || '' };
    await writeCache(key, {
      mode: tool.mode,
      title: tool.title || 'Concept',
      summary: tool.summary || '',
      content,
      prerequisites: tool.prerequisites || [],
    });
    send('complete', {
      mode: tool.mode,
      title: tool.title || 'Concept',
      summary: tool.summary || '',
      content,
      prerequisites: tool.prerequisites || [],
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

function buildExplainUserMsg(opts: {
  text: string; question?: string; parentTitle?: string; docSummary?: string; force?: 'text' | 'visual_html' | 'video_manim';
}): string {
  const parts = [
    opts.docSummary ? `DOCUMENT SUMMARY (anchor the domain):\n${opts.docSummary}` : null,
    opts.parentTitle ? `Parent concept already explained: ${opts.parentTitle}` : null,
    `Highlighted text from the document:\n"""${opts.text}"""`,
    opts.question
      ? `User's specific question: """${opts.question}"""`
      : `The user did not ask a specific question — pick the best lesson type and produce a thorough explanation.`,
    opts.force ? `User explicitly requested the lesson type: ${opts.force}. Honor that.` : null,
    `Call emit_lesson now.`,
  ].filter(Boolean);
  return parts.join('\n\n');
}

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, '127.0.0.1', () => console.log(`tutor server on :${PORT}`));
