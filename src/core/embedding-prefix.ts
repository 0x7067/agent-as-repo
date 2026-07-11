/**
 * Nomic embed models are asymmetric: retrieval quality depends on tagging
 * documents with `search_document: ` and queries with `search_query: ` before
 * embedding. This pure lookup maps a model id to the prefix pair to prepend for
 * each task; non-nomic models get empty prefixes (raw text passes through).
 */

/** Prefix to prepend to text before embedding, keyed by retrieval task. */
export interface EmbeddingTaskPrefixes {
  document: string;
  query: string;
}

/**
 * Returns the nomic task prefixes when `model` names a nomic-embed variant
 * (case-insensitive substring match on `nomic-embed`, covering both
 * `nomic-embed-text` and `nomic-ai/nomic-embed-text-v1.5`), else empty
 * prefixes so every other model embeds raw text unchanged.
 */
export function embeddingTaskPrefixes(model: string): EmbeddingTaskPrefixes {
  if (model.toLowerCase().includes("nomic-embed")) {
    return { document: "search_document: ", query: "search_query: " };
  }
  return { document: "", query: "" };
}
