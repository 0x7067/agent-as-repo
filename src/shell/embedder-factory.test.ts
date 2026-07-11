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
      { engine: "http", model: "text-embedding-3-small", baseUrl: "http://localhost:11434/v1", apiKey: "sk-test" },
      deps,
    );

    await expect(embed(["hello"], "document")).resolves.toEqual([[1]]);
    expect(deps.httpEmbed).toHaveBeenCalledWith(
      ["hello"],
      "text-embedding-3-small",
      "http://localhost:11434/v1",
      "sk-test",
    );
    expect(deps.createLocalEmbedder).not.toHaveBeenCalled();
  });

  it("builds an in-process embedder for the transformersjs engine", async () => {
    const deps = fakeDeps();
    const embed = createEmbedder(
      { engine: "transformersjs", model: "mxbai-embed-large", baseUrl: "http://localhost:11434/v1" },
      deps,
    );

    await expect(embed(["hello"], "document")).resolves.toEqual([[9]]);
    expect(deps.createLocalEmbedder).toHaveBeenCalledWith("mxbai-embed-large");
    expect(deps.localEmbed).toHaveBeenCalledWith(["hello"], "document");
    expect(deps.httpEmbed).not.toHaveBeenCalled();
  });

  it("passes non-nomic text through unchanged for both tasks", async () => {
    const deps = fakeDeps();
    const embed = createEmbedder(
      { engine: "http", model: "text-embedding-3-small", baseUrl: "http://localhost:11434/v1", apiKey: "sk-x" },
      deps,
    );

    await embed(["a", "b"], "document");
    await embed(["q"], "query");

    expect(deps.httpEmbed).toHaveBeenNthCalledWith(1, ["a", "b"], "text-embedding-3-small", "http://localhost:11434/v1", "sk-x");
    expect(deps.httpEmbed).toHaveBeenNthCalledWith(2, ["q"], "text-embedding-3-small", "http://localhost:11434/v1", "sk-x");
  });

  it("prepends nomic task prefixes for the http engine", async () => {
    const deps = fakeDeps();
    const embed = createEmbedder(
      { engine: "http", model: "nomic-embed-text", baseUrl: "http://localhost:11434/v1", apiKey: "sk-test" },
      deps,
    );

    await embed(["login logic", "session"], "document");
    await embed(["how does login work"], "query");

    expect(deps.httpEmbed).toHaveBeenNthCalledWith(
      1,
      ["search_document: login logic", "search_document: session"],
      "nomic-embed-text",
      "http://localhost:11434/v1",
      "sk-test",
    );
    expect(deps.httpEmbed).toHaveBeenNthCalledWith(
      2,
      ["search_query: how does login work"],
      "nomic-embed-text",
      "http://localhost:11434/v1",
      "sk-test",
    );
  });

  it("prepends nomic task prefixes for the transformersjs engine", async () => {
    const deps = fakeDeps();
    const embed = createEmbedder(
      { engine: "transformersjs", model: "nomic-ai/nomic-embed-text-v1.5", baseUrl: "http://localhost:11434/v1" },
      deps,
    );

    await embed(["a document"], "document");
    await embed(["a query"], "query");

    expect(deps.localEmbed).toHaveBeenNthCalledWith(1, ["search_document: a document"], "document");
    expect(deps.localEmbed).toHaveBeenNthCalledWith(2, ["search_query: a query"], "query");
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
