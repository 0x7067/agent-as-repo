import { embeddingTaskPrefixes } from "../core/embedding-prefix.js";
import type { EmbeddingEngine } from "../core/types.js";
import { embed } from "./llm-client.js";
import { createTransformersJsEmbedder } from "./transformersjs-embedder.js";
import type { EmbedTexts } from "./sqlite-store.js";

export interface EmbedderParams {
  engine: EmbeddingEngine;
  model: string;
  baseUrl: string;
  apiKey?: string;
}

export interface EmbedderDeps {
  httpEmbed: typeof embed;
  createLocalEmbedder: (model: string) => EmbedTexts;
}

const defaultDeps: EmbedderDeps = {
  httpEmbed: embed,
  createLocalEmbedder: createTransformersJsEmbedder,
};

/**
 * Build the embedding function for the configured engine, wrapped so that
 * asymmetric models (nomic-embed) get the per-task `search_document:` /
 * `search_query:` prefix prepended before the raw text reaches the underlying
 * engine embedder. Non-nomic models get empty prefixes, so text passes through
 * unchanged. Prefix knowledge lives only here + the core lookup — the engine
 * embedders stay prefix-agnostic.
 */
export function createEmbedder(params: EmbedderParams, deps: EmbedderDeps = defaultDeps): EmbedTexts {
  const prefixes = embeddingTaskPrefixes(params.model);
  const underlying: EmbedTexts =
    params.engine === "transformersjs"
      ? deps.createLocalEmbedder(params.model)
      : (texts) => deps.httpEmbed(texts, params.model, params.baseUrl, params.apiKey);
  return (texts, task) => {
    const prefix = prefixes[task];
    const prefixed = prefix === "" ? texts : texts.map((text) => prefix + text);
    return underlying(prefixed, task);
  };
}

/** Parses the `LLM_EMBEDDING_ENGINE` env var; anything but the exact string falls back to "http". */
export function parseEmbeddingEngine(raw?: string): EmbeddingEngine {
  return raw === "transformersjs" ? "transformersjs" : "http";
}
