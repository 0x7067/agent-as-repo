import type * as TransformersModule from "@huggingface/transformers";
import type { EmbedTexts } from "./sqlite-store.js";

/** Result surface we need from a transformers.js feature-extraction call. */
export interface EmbeddingTensor {
  tolist(): number[][];
}

/** Minimal callable surface of a transformers.js feature-extraction pipeline. */
export type FeatureExtractionCall = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<EmbeddingTensor>;

export type PipelineLoader = (model: string) => Promise<FeatureExtractionCall>;

async function loadTransformersJsPipeline(model: string): Promise<FeatureExtractionCall> {
  let transformers: typeof TransformersModule;
  try {
    transformers = await import("@huggingface/transformers");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot load @huggingface/transformers (${message}). ` +
        'Reinstall dependencies with "pnpm install", or set provider.embedding_engine back to "http".',
      { cause: error },
    );
  }

  const pipe = await transformers.pipeline("feature-extraction", model, { dtype: "q8" });
  return async (texts, options) => (await pipe(texts, options)) as EmbeddingTensor;
}

/**
 * In-process embedder backed by a transformers.js feature-extraction pipeline
 * (ONNX weights are downloaded from the Hugging Face Hub on first use and
 * cached). The pipeline loads lazily on the first embed call, so enabling the
 * engine costs nothing until embeddings are actually needed.
 */
export function createTransformersJsEmbedder(
  model: string,
  loadPipeline: PipelineLoader = loadTransformersJsPipeline,
): EmbedTexts {
  let pipelinePromise: Promise<FeatureExtractionCall> | undefined;

  return async (texts) => {
    if (texts.length === 0) return [];

    pipelinePromise ??= loadPipeline(model);
    let pipeline: FeatureExtractionCall;
    try {
      pipeline = await pipelinePromise;
    } catch (error) {
      // First-use model download can fail transiently; allow the next call to retry.
      pipelinePromise = undefined;
      throw error;
    }

    const output = await pipeline(texts, { pooling: "mean", normalize: true });
    const vectors = output.tolist();
    if (vectors.length !== texts.length) {
      throw new Error(
        `transformers.js embedder returned an embedding count mismatch: expected ${String(texts.length)}, got ${String(vectors.length)}`,
      );
    }
    return vectors;
  };
}
