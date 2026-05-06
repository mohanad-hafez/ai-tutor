import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, createReadStream } from 'fs';
import type { Response } from 'express';
import { client, MAIN_MODEL, findToolUse } from './anthropic.js';
import { MANIM_SYSTEM, MANIM_TOOL } from './lessonPrompts.js';
import { cacheKey, readCache, writeCache } from './cache.js';
import { manimWorker } from './manimWorker.js';

export interface VideoChapter { t: number; label: string }

export type VideoStage = 'queued' | 'planning' | 'generating' | 'rendering' | 'done' | 'error';

interface VideoJob {
  id: string;
  stage: VideoStage;
  progress: number;
  message: string;
  title?: string;
  summary?: string;
  videoUrl?: string;
  durationSec?: number;
  chapters?: VideoChapter[];
  error?: string;
  subscribers: Response[];
  createdAt: number;
  renderStartedAt?: number;
  etaSec?: number;
  cancelled?: boolean;
  // backreference to running child process so /api/video/:id (DELETE) can kill it
  child?: import('child_process').ChildProcessWithoutNullStreams;
}

const jobs = new Map<string, VideoJob>();

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC_VIDEOS_DIR = path.join(REPO_ROOT, 'public', 'videos');
const TMP_DIR = path.join(REPO_ROOT, 'server', 'tmp');
const CACHED_VIDEOS_DIR = path.join(REPO_ROOT, 'server', 'cache', 'videos');

await fs.mkdir(PUBLIC_VIDEOS_DIR, { recursive: true });
await fs.mkdir(TMP_DIR, { recursive: true });
await fs.mkdir(CACHED_VIDEOS_DIR, { recursive: true });

function emit(job: VideoJob, event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of job.subscribers) {
    try { res.write(payload); } catch { /* client gone */ }
  }
}

function setStage(job: VideoJob, stage: VideoStage, progress: number, message: string) {
  job.stage = stage;
  job.progress = progress;
  job.message = message;
  if (stage === 'rendering' && !job.renderStartedAt) {
    job.renderStartedAt = Date.now();
  }
  emit(job, 'stage', { stage, progress, message, etaSec: computeEta(job) });
}

function computeEta(job: VideoJob): number | undefined {
  if (job.stage !== 'rendering' || !job.renderStartedAt || !job.durationSec) return undefined;
  // empirical: low-quality render is roughly 1.0–1.4× video duration on a modern laptop
  const elapsed = (Date.now() - job.renderStartedAt) / 1000;
  const total = job.durationSec * 1.3;
  return Math.max(0, Math.round(total - elapsed));
}

export function getJob(id: string) { return jobs.get(id); }

export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  if (job.stage === 'done' || job.stage === 'error') return false;
  job.cancelled = true;
  if (job.child) {
    try { job.child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  job.error = 'Cancelled by user';
  setStage(job, 'error', 100, 'Cancelled');
  emit(job, 'error', { message: job.error });
  for (const res of job.subscribers) { try { res.end(); } catch { /* ignore */ } }
  job.subscribers = [];
  return true;
}

export function subscribe(id: string, res: Response) {
  const job = jobs.get(id);
  if (!job) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  res.write(`event: stage\ndata: ${JSON.stringify({ stage: job.stage, progress: job.progress, message: job.message, etaSec: computeEta(job) })}\n\n`);

  if (job.stage === 'done') {
    res.write(`event: done\ndata: ${JSON.stringify({
      videoUrl: job.videoUrl, durationSec: job.durationSec, chapters: job.chapters, title: job.title, summary: job.summary,
    })}\n\n`);
    res.end();
    return;
  }
  if (job.stage === 'error') {
    res.write(`event: error\ndata: ${JSON.stringify({ message: job.error })}\n\n`);
    res.end();
    return;
  }

  job.subscribers.push(res);
  const heartbeat = setInterval(() => {
    try { res.write(`: ping\n\n`); } catch { /* ignore */ }
  }, 15000);
  res.on('close', () => {
    clearInterval(heartbeat);
    job.subscribers = job.subscribers.filter((r) => r !== res);
  });
}

interface CreateInput {
  text: string;
  question?: string;
  docSummary?: string;
  brief?: string;
  parentTitle?: string;
}

export function createVideoJob(input: CreateInput): { jobId: string } {
  const id = cryptoRandom();
  const job: VideoJob = {
    id,
    stage: 'queued',
    progress: 0,
    message: 'Queued',
    subscribers: [],
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  void runJob(job, input);
  return { jobId: id };
}

function cryptoRandom() {
  return [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function runJob(job: VideoJob, input: CreateInput) {
  const workDir = path.join(TMP_DIR, job.id);
  try {
    // Cache lookup: same brief + same domain + same source = same animation
    const ck = cacheKey({
      kind: 'video',
      text: input.text,
      question: input.question,
      docSummary: input.docSummary,
      parentTitle: input.parentTitle,
      brief: input.brief,
      model: MAIN_MODEL,
    });
    const cached = await readCache<{
      title: string;
      summary: string;
      durationSec: number;
      chapters: VideoChapter[];
      cachedFile: string;
    }>(ck);
    if (cached) {
      const cachedPath = path.join(CACHED_VIDEOS_DIR, cached.cachedFile);
      if (existsSync(cachedPath)) {
        const finalName = `${job.id}.mp4`;
        const finalPath = path.join(PUBLIC_VIDEOS_DIR, finalName);
        await fs.copyFile(cachedPath, finalPath);
        job.title = cached.title;
        job.summary = cached.summary;
        job.durationSec = cached.durationSec;
        job.chapters = cached.chapters;
        job.videoUrl = `/videos/${finalName}`;
        setStage(job, 'done', 100, 'Done (cached)');
        emit(job, 'done', {
          videoUrl: job.videoUrl,
          durationSec: job.durationSec,
          chapters: job.chapters,
          title: job.title,
          summary: job.summary,
        });
        for (const res of job.subscribers) { try { res.end(); } catch { /* ignore */ } }
        job.subscribers = [];
        setTimeout(() => jobs.delete(job.id), 60_000);
        return;
      }
    }

    await fs.mkdir(workDir, { recursive: true });

    setStage(job, 'planning', 5, 'Planning the animation');
    const plan = await generateManim(input);
    job.title = plan.title;
    job.summary = plan.summary;
    job.chapters = plan.chapters;
    job.durationSec = plan.duration_estimate;

    setStage(job, 'generating', 25, 'Validating script');
    sandboxCheck(plan.python);

    const scenePath = path.join(workDir, 'scene.py');
    await fs.writeFile(scenePath, plan.python, 'utf8');

    setStage(job, 'rendering', 40, 'Rendering with Manim');
    const tick = setInterval(() => {
      emit(job, 'stage', {
        stage: job.stage,
        progress: job.progress,
        message: job.message,
        etaSec: computeEta(job),
      });
    }, 2000);
    let renderResult: { videoPath: string | null; stderr: string };
    try {
      renderResult = await renderManim(scenePath, workDir, job);
    } finally {
      clearInterval(tick);
    }
    if (job.cancelled) return;
    let { videoPath, stderr } = renderResult;

    if (!videoPath) {
      // self-repair: feed stderr back
      setStage(job, 'planning', 50, 'Render failed — repairing script');
      const repaired = await repairManim(input, plan.python, stderr);
      sandboxCheck(repaired.python);
      await fs.writeFile(scenePath, repaired.python, 'utf8');
      job.chapters = repaired.chapters;
      job.durationSec = repaired.duration_estimate;
      setStage(job, 'rendering', 70, 'Rendering repaired script');
      const second = await renderManim(scenePath, workDir, job);
      if (job.cancelled) return;
      videoPath = second.videoPath;
      if (!videoPath) {
        throw new Error('Manim render failed twice. Last stderr: ' + (second.stderr.slice(-2000) || stderr.slice(-2000)));
      }
    }

    const finalName = `${job.id}.mp4`;
    const finalPath = path.join(PUBLIC_VIDEOS_DIR, finalName);
    await fs.copyFile(videoPath, finalPath);

    // Persist to cache for future identical requests
    const cachedFileName = `${ck}.mp4`;
    const cachedPath = path.join(CACHED_VIDEOS_DIR, cachedFileName);
    await fs.copyFile(videoPath, cachedPath).catch(() => {});
    await writeCache(ck, {
      title: job.title || '',
      summary: job.summary || '',
      durationSec: job.durationSec || 0,
      chapters: job.chapters || [],
      cachedFile: cachedFileName,
    });

    job.videoUrl = `/videos/${finalName}`;
    setStage(job, 'done', 100, 'Done');
    emit(job, 'done', {
      videoUrl: job.videoUrl,
      durationSec: job.durationSec,
      chapters: job.chapters,
      title: job.title,
      summary: job.summary,
    });

    fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  } catch (err) {
    job.error = (err as Error).message;
    setStage(job, 'error', 100, 'Failed');
    emit(job, 'error', { message: job.error });
    fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  } finally {
    for (const res of job.subscribers) { try { res.end(); } catch { /* ignore */ } }
    job.subscribers = [];
    setTimeout(() => jobs.delete(job.id), 60_000);
  }
}

interface ManimPlan {
  python: string;
  duration_estimate: number;
  chapters: VideoChapter[];
  title: string;
  summary: string;
}

async function generateManim(input: CreateInput): Promise<ManimPlan> {
  const userMsg = buildManimUserMsg(input);
  const completion = await client.messages.create({
    model: MAIN_MODEL,
    system: MANIM_SYSTEM,
    max_tokens: 8192,
    tools: [MANIM_TOOL],
    tool_choice: { type: 'tool', name: 'emit_manim' },
    messages: [{ role: 'user', content: userMsg }],
  });
  const tool = findToolUse<{ python: string; duration_estimate: number; chapters: VideoChapter[] }>(completion, 'emit_manim');
  if (!tool) throw new Error('Model did not call emit_manim');

  const title = (input.brief || input.text).slice(0, 60).trim();
  return {
    python: tool.python,
    duration_estimate: tool.duration_estimate,
    chapters: tool.chapters,
    title,
    summary: 'Animated explanation',
  };
}

async function repairManim(input: CreateInput, prevPython: string, stderr: string): Promise<ManimPlan> {
  const userMsg = `${buildManimUserMsg(input)}\n\nThe previous Manim script failed to render with this stderr (last 2000 chars):\n"""\n${stderr.slice(-2000)}\n"""\n\nPrevious script:\n\`\`\`python\n${prevPython}\n\`\`\`\n\nFix the issue and emit a corrected complete script. Keep the same teaching intent.`;
  const completion = await client.messages.create({
    model: MAIN_MODEL,
    system: MANIM_SYSTEM,
    max_tokens: 8192,
    tools: [MANIM_TOOL],
    tool_choice: { type: 'tool', name: 'emit_manim' },
    messages: [{ role: 'user', content: userMsg }],
  });
  const tool = findToolUse<{ python: string; duration_estimate: number; chapters: VideoChapter[] }>(completion, 'emit_manim');
  if (!tool) throw new Error('Model did not call emit_manim during repair');
  return {
    python: tool.python,
    duration_estimate: tool.duration_estimate,
    chapters: tool.chapters,
    title: (input.brief || input.text).slice(0, 60).trim(),
    summary: 'Animated explanation',
  };
}

function buildManimUserMsg(input: CreateInput): string {
  const parts = [
    input.docSummary ? `DOCUMENT SUMMARY (anchor the domain):\n${input.docSummary}` : null,
    input.parentTitle ? `Parent concept: ${input.parentTitle}` : null,
    input.brief
      ? `Animation brief from upstream tutor:\n${input.brief}`
      : `Highlighted text from the document:\n"""${input.text}"""`,
    input.question ? `User's specific question: ${input.question}` : null,
    `Write a Manim Scene named Lesson that animates this concept clearly. Call emit_manim once.`,
  ].filter(Boolean);
  return parts.join('\n\n');
}

const FORBIDDEN_PATTERNS = [
  /\bimport\s+os\b/,
  /\bimport\s+sys\b/,
  /\bimport\s+subprocess\b/,
  /\bimport\s+socket\b/,
  /\bimport\s+requests\b/,
  /\bimport\s+urllib\b/,
  /\bimport\s+shutil\b/,
  /\bimport\s+pathlib\b/,
  /\bfrom\s+os\b/,
  /\bfrom\s+subprocess\b/,
  /\bfrom\s+socket\b/,
  /\bfrom\s+pathlib\b/,
  /\b__import__\s*\(/,
  /\bopen\s*\(/,
  /\bexec\s*\(/,
  /\beval\s*\(/,
  /\bcompile\s*\(/,
  /\bglobals\s*\(/,
  /\blocals\s*\(/,
  /\bgetattr\s*\(\s*[^,]+,\s*['"]__/,
];

const ALLOWED_TOP_LEVEL_MODULES = new Set([
  'manim',
  'numpy',
  'math',
  'manim_voiceover',
]);

function sandboxCheck(py: string) {
  if (!/from\s+manim\s+import\s+\*/.test(py)) {
    throw new Error('Script must start with: from manim import *');
  }
  if (!/class\s+Lesson\s*\(/.test(py)) {
    throw new Error('Script must define class Lesson');
  }
  for (const p of FORBIDDEN_PATTERNS) {
    if (p.test(py)) throw new Error(`Forbidden construct in script: ${p}`);
  }
  const importLines = py.split('\n').filter((l) => /^\s*(from|import)\s/.test(l));
  for (const line of importLines) {
    const m = line.match(/^\s*(?:from|import)\s+([\w.]+)/);
    if (!m) continue;
    const top = m[1].split('.')[0];
    if (!ALLOWED_TOP_LEVEL_MODULES.has(top)) {
      throw new Error(`Disallowed import: ${line.trim()}`);
    }
  }
}

async function renderManim(scenePath: string, workDir: string, job?: VideoJob): Promise<{ videoPath: string | null; stderr: string }> {
  const mediaDir = path.join(workDir, 'media');
  // First try the long-lived Python worker. It skips the ~3-5s `import manim`
  // cost the CLI pays on every invocation.
  if (process.env.MANIM_WORKER !== 'off') {
    const r = await manimWorker.render(scenePath, mediaDir, 'lesson.mp4', (p) => {
      if (job) job.child = p;
    });
    if (job) job.child = undefined;
    if (r.videoPath) return r;
    // Worker said error or unavailable. If the failure looks like the worker
    // itself dying or being disabled, fall back to the CLI subprocess so the
    // render still goes through.
    if (/worker (unavailable|disabled|exited|spawn|warmup)/i.test(r.stderr)) {
      return runManimCli(scenePath, workDir, mediaDir, job);
    }
    // Otherwise the script itself failed — surface the worker error so the
    // self-repair pass can correct the script.
    return r;
  }
  return runManimCli(scenePath, workDir, mediaDir, job);
}

function runManimCli(scenePath: string, workDir: string, mediaDir: string, job?: VideoJob): Promise<{ videoPath: string | null; stderr: string }> {
  return new Promise((resolve) => {
    const args = [
      'render',
      '-q', 'l',
      '--media_dir', mediaDir,
      '--output_file', 'lesson.mp4',
      '--disable_caching',
      scenePath,
      'Lesson',
    ];
    const p = spawn('manim', args, { cwd: workDir });
    if (job) job.child = p;
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.stdout.on('data', (d) => { stderr += d.toString(); });
    p.on('error', (e) => {
      if (job) job.child = undefined;
      resolve({ videoPath: null, stderr: stderr + '\n' + e.message });
    });
    p.on('close', async (code) => {
      if (job) job.child = undefined;
      if (code !== 0) {
        resolve({ videoPath: null, stderr });
        return;
      }
      const found = await findOutputMp4(mediaDir);
      resolve({ videoPath: found, stderr });
    });
  });
}

async function findOutputMp4(mediaDir: string): Promise<string | null> {
  if (!existsSync(mediaDir)) return null;
  const stack = [mediaDir];
  while (stack.length) {
    const dir = stack.pop()!;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name.endsWith('.mp4')) return full;
    }
  }
  return null;
}

export function streamVideo(filePath: string, res: Response) {
  if (!existsSync(filePath)) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  createReadStream(filePath).pipe(res);
}
