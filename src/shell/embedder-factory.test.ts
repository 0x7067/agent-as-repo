import { describe, it, expect, vi } from "vitest";
import { createEmbedder, parseEmbeddingEngine, type EmbedderDeps } from "./embedder-factory.js";

function fakeDeps(): EmbedderDeps & { localEmbed: ReturnType<typeof vi.fn> } {
  const localEmbed = vi.fn(() => Promise.resolve([[9]]));
  return {
    httpEmbed: vi.fn(() => Promise.resolve([[1]])),
    createLocalEmbedder: vi.fn(() => localEmbed),
    localEmbed,
  };
}

describe("createEmbedder", () => {
  it("delegates to the HTTP embed endpoint for the http engine", async () => {
    const deps = fakeDeps();
    const embed = createEmbedder(
      { engine: "http", model: "nomic-embed-text", baseUrl: "http://localhost:11434/v1", apiKey: "sk-test" },
      deps,
    );

    await expect(embed(["hello"])).resolves.toEqual([[1]]);
    expect(deps.httpEmbed).toHaveBeenCalledWith(["hello"], "nomic-embed-text", "http://localhost:11434/v1", "sk-test");
    expect(deps.createLocalEmbedder).not.toHaveBeenCalled();
  });

  it("builds an in-process embedder for the transformersjs engine", async () => {
    const deps = fakeDeps();
    const embed = createEmbedder(
      { engine: "transformersjs", model: "nomic-ai/nomic-embed-text-v1.5", baseUrl: "http://localhost:11434/v1" },
      deps,
    );

    await expect(embed(["hello"])).resolves.toEqual([[9]]);
    expect(deps.createLocalEmbedder).toHaveBeenCalledWith("nomic-ai/nomic-embed-text-v1.5");
    expect(deps.httpEmbed).not.toHaveBeenCalled();
  });
});

describe("parseEmbeddingEngine", () => {
  it("returns transformersjs only for the exact engine name", () => {
    expect(parseEmbeddingEngine("transformersjs")).toBe("transformersjs");
  });

  it("falls back to http for unset or unknown values", () => {
    expect(parseEmbeddingEngine()).toBe("http");
    expect(parseEmbeddingEngine("")).toBe("http");
    expect(parseEmbeddingEngine("webgpu")).toBe("http");
  });
});
