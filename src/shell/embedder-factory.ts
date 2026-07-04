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

/** Build the embedding function for the configured engine. */
export function createEmbedder(params: EmbedderParams, deps: EmbedderDeps = defaultDeps): EmbedTexts {
  if (params.engine === "transformersjs") {
    return deps.createLocalEmbedder(params.model);
  }
  return (texts) => deps.httpEmbed(texts, params.model, params.baseUrl, params.apiKey);
}

/** Parses the `LLM_EMBEDDING_ENGINE` env var; anything but the exact string falls back to "http". */
export function parseEmbeddingEngine(raw?: string): EmbeddingEngine {
  return raw === "transformersjs" ? "transformersjs" : "http";
}
