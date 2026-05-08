/**
 * Voyager-style skill induction — three agents, three stores.
 *
 *   1 Extractor  ── writes ──▶  2 Vector DB     (clusters candidates by description embedding)
 *                  ◀── reads ──
 *   3 Sweeper    ── writes ──▶  4 proposals.js  (staged canonical fns + test calls)
 *                  ◀── reads ──
 *   5 Merger     ── execute+merge ──▶  6 library.js  (live, RAG'd by Author at lesson time)
 *
 * Extension over Voyager (Wang et al. 2023): quorum (recurrence ≥ 3),
 * execution oracle (headless browser), and a staging file that lets the
 * Merger reject without losing work.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { client, MAIN_MODEL, FAST_MODEL, findToolUse } from './anthropic.js';
import { embed, cosine } from './embeddings.js';

const DB_PATH = path.resolve('server/cache/vector-db.json');
const PROPOSALS_PATH = path.resolve('server/cache/proposals.js');
const LIBRARY_PATH = path.resolve('server/cache/library.js');

const SIM_THRESHOLD = Number(process.env.SKILL_SIM_THRESHOLD ?? 0.7);
const QUORUM = Number(process.env.SKILL_QUORUM ?? 3);
const DEDUP_THRESHOLD = Number(process.env.SKILL_DEDUP_THRESHOLD ?? 0.85);
const MAX_EXEMPLARS = 8;

// ════════════════ 2 — Vector DB ════════════════

interface Exemplar { fn: string; description: string; addedAt: number }
interface Bucket {
  id: string;
  centroidDescription: string;
  centroidEmbedding: number[];
  count: number;
  exemplars: Exemplar[];
  promoted: boolean;
}
interface DB { buckets: Bucket[] }

async function loadDB(): Promise<DB> {
  try { return JSON.parse(await fs.readFile(DB_PATH, 'utf8')); }
  catch { return { buckets: [] }; }
}
async function saveDB(db: DB): Promise<void> {
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

async function ingestToDB(c: Candidate): Promise<void> {
  const db = await loadDB();
  const emb = await embed(c.description);
  let best: { bucket: Bucket; score: number } | null = null;
  for (const b of db.buckets) {
    const score = cosine(emb, new Float32Array(b.centroidEmbedding));
    if (score > (best?.score ?? -1)) best = { bucket: b, score };
  }
  if (best && best.score >= SIM_THRESHOLD) {
    best.bucket.count += 1;
    if (best.bucket.exemplars.length < MAX_EXEMPLARS) {
      best.bucket.exemplars.push({ fn: c.fn, description: c.description, addedAt: Date.now() });
    }
  } else {
    db.buckets.push({
      id: `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      centroidDescription: c.description,
      centroidEmbedding: Array.from(emb),
      count: 1,
      exemplars: [{ fn: c.fn, description: c.description, addedAt: Date.now() }],
      promoted: false,
    });
  }
  await saveDB(db);
}

// ════════════════ 1 — Extractor ════════════════

const EXTRACTOR_TOOL = {
  name: 'emit_candidates',
  description: 'Emit reusable code chunks found in this lesson.',
  input_schema: {
    type: 'object' as const,
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            fn: { type: 'string', description: 'Full JS source of the helper, including signature.' },
            description: { type: 'string', description: 'One line: what it does, what it takes, what it returns.' },
          },
          required: ['fn', 'description'],
        },
      },
    },
    required: ['candidates'],
  },
};

const EXTRACTOR_SYSTEM = `Scan one lesson's JS body for chunks that look like reusable helpers — small, parameterized, free of page-specific selectors. Emit each as {fn, description}. Skip glue that wires THIS specific lesson together. Better to emit zero than emit junk.`;

export interface Candidate { fn: string; description: string }

export async function runExtractor(lessonJs: string): Promise<Candidate[]> {
  if (!lessonJs || lessonJs.length < 100) return [];
  const resp = await client.messages.create({
    model: FAST_MODEL,
    system: [{ type: 'text', text: EXTRACTOR_SYSTEM, cache_control: { type: 'ephemeral' } }],
    max_tokens: 2048,
    tools: [EXTRACTOR_TOOL],
    tool_choice: { type: 'tool', name: 'emit_candidates' },
    messages: [{ role: 'user', content: lessonJs.slice(0, 8000) }],
  });
  const tool = findToolUse<{ candidates: Candidate[] }>(resp, 'emit_candidates');
  const cands = tool?.candidates ?? [];
  for (const c of cands) await ingestToDB(c);
  return cands;
}

// ════════════════ 4 — proposals.js ════════════════

interface Proposal {
  bucketId: string;
  name: string;
  description: string;
  fn: string;
  testCall: string;
  cluster: number;
  proposedAt: number;
}

async function loadProposals(): Promise<Proposal[]> {
  try {
    const raw = await fs.readFile(PROPOSALS_PATH, 'utf8');
    const m = raw.match(/PROPOSALS = (\[[\s\S]*\]);/);
    return m ? JSON.parse(m[1]) : [];
  } catch { return []; }
}
async function saveProposals(p: Proposal[]): Promise<void> {
  await fs.mkdir(path.dirname(PROPOSALS_PATH), { recursive: true });
  await fs.writeFile(
    PROPOSALS_PATH,
    `// Auto-generated by Sweeper. Merger consumes this file.\nexport const PROPOSALS = ${JSON.stringify(p, null, 2)};\n`,
  );
}

// ════════════════ 3 — Sweeper ════════════════

const SWEEPER_TOOL = {
  name: 'synthesize_skill',
  description: 'Synthesize a canonical helper from a clustered set of exemplars, plus one test call.',
  input_schema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: 'camelCase identifier' },
      description: { type: 'string' },
      fn: { type: 'string', description: 'Full JS function source — clean, parameterized, no globals.' },
      testCall: {
        type: 'string',
        description: "JS expression that exercises fn with synthetic args, e.g. \"darkPlot('#p', [{x:[1,2],y:[1,4]}])\"",
      },
    },
    required: ['name', 'description', 'fn', 'testCall'],
  },
};

const SWEEPER_SYSTEM = `You synthesize one canonical helper from N exemplars of the same recurring pattern. Take the best ideas from each, eliminate page-specific selectors, give it a clean signature. Then emit one testCall — a JS expression invoking fn with synthetic arguments so the Merger's headless browser can verify it runs cleanly.`;

export async function runSweeper(): Promise<{ proposed: string[] }> {
  const db = await loadDB();
  const ready = db.buckets.filter((b) => !b.promoted && b.count >= QUORUM);
  if (!ready.length) return { proposed: [] };

  const proposals = await loadProposals();
  const proposed: string[] = [];

  for (const b of ready) {
    const userMsg = [
      `Cluster size: ${b.count}`,
      `Centroid description: ${b.centroidDescription}`,
      'Exemplars:',
      ...b.exemplars.map((e, i) => `[${i + 1}] ${e.description}\n${e.fn}`),
    ].join('\n\n');

    const resp = await client.messages.create({
      model: MAIN_MODEL,
      system: [{ type: 'text', text: SWEEPER_SYSTEM, cache_control: { type: 'ephemeral' } }],
      max_tokens: 2048,
      tools: [SWEEPER_TOOL],
      tool_choice: { type: 'tool', name: 'synthesize_skill' },
      messages: [{ role: 'user', content: userMsg }],
    });
    const tool = findToolUse<{ name: string; description: string; fn: string; testCall: string }>(resp, 'synthesize_skill');
    if (!tool) continue;

    proposals.push({
      bucketId: b.id,
      name: tool.name,
      description: tool.description,
      fn: tool.fn,
      testCall: tool.testCall,
      cluster: b.count,
      proposedAt: Date.now(),
    });
    b.promoted = true;
    proposed.push(tool.name);
  }

  await saveProposals(proposals);
  await saveDB(db);
  return { proposed };
}

// ════════════════ 6 — library.js ════════════════

interface Skill {
  name: string;
  description: string;
  fn: string;
  embedding: number[];
  mergedAt: number;
}

async function loadLibrary(): Promise<Skill[]> {
  try {
    const raw = await fs.readFile(LIBRARY_PATH, 'utf8');
    const m = raw.match(/SKILLS = (\[[\s\S]*\]);/);
    return m ? JSON.parse(m[1]) : [];
  } catch { return []; }
}
async function saveLibrary(s: Skill[]): Promise<void> {
  await fs.mkdir(path.dirname(LIBRARY_PATH), { recursive: true });
  await fs.writeFile(
    LIBRARY_PATH,
    `// Live skill library. Author RAGs this at lesson time.\nexport const SKILLS = ${JSON.stringify(s, null, 2)};\n`,
  );
}

// ════════════════ 5 — Merger ════════════════
//
// Headless browser is our execution oracle: load CDN deps, define fn,
// invoke testCall, watch for thrown errors and console.error. Pass +
// not-duplicate → merge. Otherwise → reject with reason.

interface VerifyResult { ok: boolean; reason?: string }

async function verifyInBrowser(p: Proposal): Promise<VerifyResult> {
  const puppeteer = await import('puppeteer').catch(() => null);
  if (!puppeteer) return { ok: false, reason: 'puppeteer not installed' };
  const browser = await puppeteer.default.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setContent(
      `<!doctype html><html><body><div id="p"></div>
      <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
      <script>
        ${p.fn}
        try { ${p.testCall} } catch (e) { console.error('TESTCALL: ' + e.message); }
      </script></body></html>`,
    );
    await new Promise((r) => setTimeout(r, 800));
    if (errors.length) return { ok: false, reason: errors.join(' | ').slice(0, 240) };
    return { ok: true };
  } finally {
    await browser.close();
  }
}

export async function runMerger(): Promise<{
  merged: string[];
  rejected: { name: string; reason: string }[];
}> {
  const proposals = await loadProposals();
  if (!proposals.length) return { merged: [], rejected: [] };

  const lib = await loadLibrary();
  const merged: string[] = [];
  const rejected: { name: string; reason: string }[] = [];

  for (const p of proposals) {
    const v = await verifyInBrowser(p);
    if (!v.ok) {
      rejected.push({ name: p.name, reason: v.reason || 'browser test failed' });
      continue;
    }

    const emb = await embed(`${p.name} ${p.description}`);
    const dup = lib.find((s) => cosine(emb, new Float32Array(s.embedding)) >= DEDUP_THRESHOLD);
    if (dup) {
      rejected.push({ name: p.name, reason: `duplicate of ${dup.name}` });
      continue;
    }

    lib.push({
      name: p.name,
      description: p.description,
      fn: p.fn,
      embedding: Array.from(emb),
      mergedAt: Date.now(),
    });
    merged.push(p.name);
  }

  await saveLibrary(lib);
  await saveProposals([]);   // staging cleared — handled proposals leave the file
  return { merged, rejected };
}

// ════════════════ Retrieval (used by Author at lesson time) ════════════════

export async function retrieveSkills(
  planText: string,
  k = 3,
  threshold = 0.35,
): Promise<{ skill: Skill; score: number }[]> {
  const lib = await loadLibrary();
  if (!lib.length) return [];
  const q = await embed(planText);
  return lib
    .map((s) => ({ skill: s, score: cosine(q, new Float32Array(s.embedding)) }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export function formatSkillsForPrompt(retrieved: { skill: Skill; score: number }[]): string {
  if (!retrieved.length) return '';
  return [
    'AVAILABLE LIBRARY SKILLS — call these directly instead of re-emitting glue:',
    ...retrieved.map(({ skill, score }) =>
      `// ${skill.name} — ${skill.description}  (cosine ${score.toFixed(2)})\n${skill.fn}`,
    ),
  ].join('\n\n');
}
