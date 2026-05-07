import { createHash } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const CACHE_DIR = path.join(REPO_ROOT, 'server', 'cache');

await fs.mkdir(CACHE_DIR, { recursive: true });

export const CACHE_ENABLED = process.env.LESSON_CACHE !== 'off';

interface KeyParts {
  kind: 'explain' | 'quiz' | 'video' | 'summary';
  text?: string;
  question?: string;
  docSummary?: string;
  parentTitle?: string;
  brief?: string;
  title?: string;
  summary?: string;
  force?: string;
  model?: string;
}

export function cacheKey(parts: KeyParts): string {
  const h = createHash('sha256');
  h.update(parts.kind);
  for (const k of ['text', 'question', 'docSummary', 'parentTitle', 'brief', 'title', 'summary', 'force', 'model'] as const) {
    h.update('|');
    h.update(parts[k] || '');
  }
  return `${parts.kind}-${h.digest('hex').slice(0, 24)}`;
}

export async function readCache<T = unknown>(key: string): Promise<T | null> {
  if (!CACHE_ENABLED) return null;
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (!existsSync(file)) return null;
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  if (!CACHE_ENABLED) return;
  const file = path.join(CACHE_DIR, `${key}.json`);
  try {
    await fs.writeFile(file, JSON.stringify(value), 'utf8');
  } catch {
    // best-effort cache, don't fail the request
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Semantic index — maps query embeddings → cache keys so paraphrases reuse
// content. Stored as a flat JSON array; linear scan is fine for hackathon-
// sized indexes (<1000 entries) and stays under 10ms.
// ────────────────────────────────────────────────────────────────────────────

import { cosine } from './embeddings.js';

export interface SemanticEntry {
  cacheKey: string;
  query: string;       // human-readable preview (truncated)
  embedding: number[]; // normalized 384-dim vector (stored as plain array for JSON)
  createdAt: number;
}

const SEMANTIC_INDEX_FILE = path.join(CACHE_DIR, 'semantic-index.json');
let semanticIndex: SemanticEntry[] | null = null;

async function loadSemanticIndex(): Promise<SemanticEntry[]> {
  if (semanticIndex) return semanticIndex;
  if (!existsSync(SEMANTIC_INDEX_FILE)) {
    semanticIndex = [];
    return semanticIndex;
  }
  try {
    const raw = await fs.readFile(SEMANTIC_INDEX_FILE, 'utf8');
    semanticIndex = JSON.parse(raw);
    return semanticIndex!;
  } catch {
    semanticIndex = [];
    return semanticIndex;
  }
}

async function persistSemanticIndex(): Promise<void> {
  if (!semanticIndex) return;
  try {
    await fs.writeFile(SEMANTIC_INDEX_FILE, JSON.stringify(semanticIndex), 'utf8');
  } catch {
    // best effort
  }
}

export async function semanticLookup(
  embedding: Float32Array,
  threshold = 0.80,
): Promise<{ entry: SemanticEntry; score: number } | null> {
  if (!CACHE_ENABLED) return null;
  const index = await loadSemanticIndex();
  if (!index.length) return null;
  let best: { entry: SemanticEntry; score: number } | null = null;
  for (const entry of index) {
    const v = new Float32Array(entry.embedding);
    const score = cosine(embedding, v);
    if (score >= threshold && (!best || score > best.score)) {
      best = { entry, score };
    }
  }
  return best;
}

export async function semanticIndexSize(): Promise<number> {
  const index = await loadSemanticIndex();
  return index.length;
}

export async function semanticInsert(
  cacheKey: string,
  query: string,
  embedding: Float32Array,
): Promise<void> {
  if (!CACHE_ENABLED) return;
  const index = await loadSemanticIndex();
  // De-dup by cacheKey: replace if it already exists (e.g. cache file rewritten).
  const idx = index.findIndex((e) => e.cacheKey === cacheKey);
  const entry: SemanticEntry = {
    cacheKey,
    query: query.slice(0, 240),
    embedding: Array.from(embedding),
    createdAt: Date.now(),
  };
  if (idx >= 0) index[idx] = entry;
  else index.push(entry);
  // Bound index size — drop oldest beyond 2000 entries.
  if (index.length > 2000) index.splice(0, index.length - 2000);
  await persistSemanticIndex();
}
