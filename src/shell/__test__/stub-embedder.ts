import type { EmbedTexts } from "../sqlite-store.js";

/**
 * Deterministic, lossy, hash-based bag-of-words embedder shared by the
 * PassageStore contract tests and the benchmark's deterministic tier, so both
 * exercise one identical implementation (no network, no model).
 *
 * Truncating each token to 4 chars makes it lossy on rare identifiers
 * (e.g. "handleAuthCallback" collides with "handles" → "hand"), reproducing
 * the failure mode of small embedding models that the lexical leg of hybrid
 * search must compensate for.
 *
 * The stub is prefix-agnostic: it embeds whatever raw text it receives. In
 * production, per-task `search_document:` / `search_query:` prefixes are added
 * by `createEmbedder` *before* the underlying embedder is called; callers that
 * want unpolluted bag-of-words vectors (the deterministic bench tier) must
 * construct the store with this stub directly, not via `createEmbedder`.
 */

const VECTOR_DIMENSION = 64;
const TOKEN_TRUNCATION = 4;

export function stubTokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter(Boolean)
    .map((word) => word.slice(0, TOKEN_TRUNCATION));
}

function embedOne(text: string): number[] {
  const vector = Array.from({ length: VECTOR_DIMENSION }, () => 0);
  for (const word of stubTokenize(text)) {
    let hash = 0;
    for (const ch of word) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
    const slot = hash % vector.length;
    vector[slot] = (vector[slot] ?? 0) + 1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((component) => component / norm);
}

/** Same text → same unit vector, regardless of the embedding task. */
export const stubEmbed: EmbedTexts = (texts) =>
  Promise.resolve(texts.map((text) => embedOne(text)));
