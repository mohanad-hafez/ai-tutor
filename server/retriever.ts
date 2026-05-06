/**
 * In-memory BM25 retriever over chunked PDF text.
 *
 * Why BM25 and not embeddings? It's a real, well-understood IR algorithm
 * that needs zero external API and zero dependencies. For same-domain
 * technical text, keyword retrieval is often competitive with embeddings
 * and an order of magnitude cheaper. We can swap in a vector store later
 * by re-implementing rank() while keeping the same chunk + index shape.
 */

import { createHash } from 'crypto';

interface Chunk {
  id: number;
  text: string;
  page?: number;
  termFreqs: Map<string, number>;
  length: number;
}

interface DocIndex {
  docId: string;
  chunks: Chunk[];
  avgLen: number;
  df: Map<string, number>; // term → number of chunks it appears in
  totalChunks: number;
  builtAt: number;
}

const indexes = new Map<string, DocIndex>();

const STOP = new Set([
  'a','an','and','are','as','at','be','but','by','for','from','has','have','he','her','his','i','in','is','it','its',
  'me','my','of','on','or','our','she','so','that','the','their','them','they','this','to','was','we','were','will',
  'with','you','your','if','then','than','can','also','do','does','did','not','no','yes','one','two','three','some',
  'any','these','those','there','here','about','into','onto','over','under','up','down','out','off','than','it.','it,',
]);

const TOKEN_RE = /[a-z0-9][a-z0-9\-_]{1,}/gi;

function tokenize(text: string): string[] {
  const out: string[] = [];
  const lc = text.toLowerCase();
  for (const m of lc.matchAll(TOKEN_RE)) {
    const t = m[0];
    if (t.length < 2 || t.length > 32) continue;
    if (STOP.has(t)) continue;
    out.push(t);
  }
  return out;
}

export function computeDocId(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export function buildIndex(text: string): { docId: string; chunkCount: number } {
  const docId = computeDocId(text);
  const existing = indexes.get(docId);
  if (existing) return { docId, chunkCount: existing.chunks.length };

  const chunks: Chunk[] = [];
  const df = new Map<string, number>();

  // Chunk by ~600 word windows with 80 word overlap so that boundary concepts
  // still appear inside at least one self-contained chunk.
  const allTokens = text.split(/\s+/).filter(Boolean);
  const WINDOW = 600;
  const STRIDE = 520;
  let id = 0;
  for (let start = 0; start < allTokens.length; start += STRIDE) {
    const window = allTokens.slice(start, start + WINDOW).join(' ');
    if (!window.trim()) continue;
    const terms = tokenize(window);
    if (!terms.length) continue;
    const tf = new Map<string, number>();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    chunks.push({ id: id++, text: window, termFreqs: tf, length: terms.length });
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const avgLen = chunks.reduce((a, c) => a + c.length, 0) / Math.max(1, chunks.length);
  indexes.set(docId, {
    docId,
    chunks,
    avgLen,
    df,
    totalChunks: chunks.length,
    builtAt: Date.now(),
  });
  // GC: keep at most 8 most-recent indexes in memory (PDFs are short-lived
  // sessions and we don't need a full LRU).
  if (indexes.size > 8) {
    const sorted = [...indexes.values()].sort((a, b) => a.builtAt - b.builtAt);
    while (indexes.size > 8) {
      const oldest = sorted.shift();
      if (oldest) indexes.delete(oldest.docId);
    }
  }
  return { docId, chunkCount: chunks.length };
}

const K1 = 1.5;
const B = 0.75;

export interface RetrievedChunk {
  text: string;
  score: number;
  chunkId: number;
}

export function retrieve(docId: string, query: string, topK = 4): RetrievedChunk[] {
  const idx = indexes.get(docId);
  if (!idx || idx.chunks.length === 0) return [];
  const queryTerms = tokenize(query);
  if (!queryTerms.length) return [];
  const N = idx.totalChunks;

  const idfFor = (t: string) => {
    const dfi = idx.df.get(t) ?? 0;
    if (dfi === 0) return 0;
    return Math.log(1 + (N - dfi + 0.5) / (dfi + 0.5));
  };

  const scored: { chunk: Chunk; score: number }[] = [];
  for (const chunk of idx.chunks) {
    let s = 0;
    for (const t of queryTerms) {
      const tf = chunk.termFreqs.get(t) ?? 0;
      if (!tf) continue;
      const idf = idfFor(t);
      const denom = tf + K1 * (1 - B + B * (chunk.length / idx.avgLen));
      s += idf * ((tf * (K1 + 1)) / denom);
    }
    if (s > 0) scored.push({ chunk, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => ({
    text: s.chunk.text,
    score: s.score,
    chunkId: s.chunk.id,
  }));
}

export function describeIndex(docId: string): { chunks: number; avgLen: number } | null {
  const idx = indexes.get(docId);
  if (!idx) return null;
  return { chunks: idx.totalChunks, avgLen: Math.round(idx.avgLen) };
}
