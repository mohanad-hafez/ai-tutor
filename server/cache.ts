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
