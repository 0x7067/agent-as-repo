import { describe, it, expect, vi } from "vitest";
import {
  createTransformersJsEmbedder,
  type FeatureExtractionCall,
} from "./transformersjs-embedder.js";

function fakePipeline(vectors: number[][]): FeatureExtractionCall {
  return vi.fn(() => Promise.resolve({ tolist: () => vectors }));
}

describe("createTransformersJsEmbedder", () => {
  it("embeds texts with mean pooling and normalization", async () => {
    const pipeline = fakePipeline([[0.1, 0.2], [0.3, 0.4]]);
    const loadPipeline = vi.fn(() => Promise.resolve(pipeline));
    const embed = createTransformersJsEmbedder("some/model", loadPipeline);

    const vectors = await embed(["first text", "second text"]);

    expect(vectors).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    expect(loadPipeline).toHaveBeenCalledWith("some/model");
    expect(pipeline).toHaveBeenCalledWith(["first text", "second text"], {
      pooling: "mean",
      normalize: true,
    });
  });

  it("loads the pipeline once across calls", async () => {
    const loadPipeline = vi.fn(() => Promise.resolve(fakePipeline([[1]])));
    const embed = createTransformersJsEmbedder("some/model", loadPipeline);

    await embed(["a"]);
    await embed(["b"]);

    expect(loadPipeline).toHaveBeenCalledTimes(1);
  });

  it("returns no vectors for empty input without loading the pipeline", async () => {
    const loadPipeline = vi.fn(() => Promise.resolve(fakePipeline([])));
    const embed = createTransformersJsEmbedder("some/model", loadPipeline);

    await expect(embed([])).resolves.toEqual([]);
    expect(loadPipeline).not.toHaveBeenCalled();
  });

  it("throws when the pipeline returns a vector count mismatch", async () => {
    const loadPipeline = vi.fn(() => Promise.resolve(fakePipeline([[1, 2]])));
    const embed = createTransformersJsEmbedder("some/model", loadPipeline);

    await expect(embed(["a", "b"])).rejects.toThrow(/expected 2, got 1/);
  });

  it("retries the pipeline load after a failed first load", async () => {
    const loadPipeline = vi
      .fn<(model: string) => Promise<FeatureExtractionCall>>()
      .mockRejectedValueOnce(new Error("download interrupted"))
      .mockResolvedValueOnce(fakePipeline([[1]]));
    const embed = createTransformersJsEmbedder("some/model", loadPipeline);

    await expect(embed(["a"])).rejects.toThrow("download interrupted");
    await expect(embed(["a"])).resolves.toEqual([[1]]);
    expect(loadPipeline).toHaveBeenCalledTimes(2);
  });
});
