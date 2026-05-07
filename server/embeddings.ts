/**
 * Local sentence embeddings via @xenova/transformers (sentence-BERT,
 * `all-MiniLM-L6-v2`, 384-dim). Runs in-process, no API key, ~50ms per
 * embedding after warmup. The model is downloaded once on first use to
 * the transformers.js cache directory and reused across server restarts.
 *
 * We use it for two things:
 *   1. Semantic cache — key prior lesson generations by query embedding,
 *      so paraphrases like "RNN" and "Recurrent Neural Networks" reuse
 *      the same content.
 *   2. Frame-level redirect — when a new highlight is semantically
 *      identical to an existing frame, focus that frame instead of
 *      regenerating.
 *
 * The pre-warm runs at server boot. Per-request cost after that is
 * negligible.
 */

import { pipeline, env, type FeatureExtractionPipeline } from '@xenova/transformers';

// Use the local cache, no remote re-fetch on each boot.
env.allowLocalModels = true;
env.allowRemoteModels = true;

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
export const EMBED_DIM = 384;

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
let warm = false;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', MODEL_NAME, {
      quantized: true, // ~30MB instead of ~80MB, negligible quality hit
    }) as Promise<FeatureExtractionPipeline>;
  }
  return extractorPromise;
}

/**
 * Pre-load the model and run a sentinel embedding so the first real
 * request pays no cold-start cost. Call once at server boot; subsequent
 * calls are no-ops.
 */
export async function warmupEmbeddings(): Promise<void> {
  if (warm) return;
  const t0 = Date.now();
  const extractor = await getExtractor();
  await extractor('warmup', { pooling: 'mean', normalize: true });
  warm = true;
  console.log(`[embeddings] warmed in ${Date.now() - t0}ms (${MODEL_NAME})`);
}

/**
 * Embed a single string into a 384-dim L2-normalized Float32Array.
 * Cosine similarity reduces to a dot product on these.
 */
export async function embed(text: string): Promise<Float32Array> {
  const extractor = await getExtractor();
  const result = await extractor(text, { pooling: 'mean', normalize: true });
  // result.data is Float32Array of size EMBED_DIM
  return new Float32Array(result.data as Float32Array);
}

/**
 * Cosine similarity for two L2-normalized vectors. Just a dot product.
 */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function isWarm(): boolean { return warm; }
