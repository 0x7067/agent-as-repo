import { describe, it, expect, vi } from "vitest";
import { makeEmbedder, DEFAULT_HTTP_EMBEDDING_MODEL, DEFAULT_HTTP_BASE_URL } from "./bench-pipeline.js";
import { stubEmbed } from "../src/shell/__test__/stub-embedder.js";
import type { EmbedderDeps } from "../src/shell/embedder-factory.js";

/**
 * Wiring tests only — never hit the network. The http engine must route
 * through `createEmbedder` (via injected deps), exactly like the CLI/MCP
 * provider path does, so nomic-style prefixes and llm-client conventions are
 * reused rather than reimplemented here.
 */
function fakeDeps(): EmbedderDeps & { httpEmbedMock: ReturnType<typeof vi.fn> } {
  const httpEmbedMock = vi.fn(() => Promise.resolve([[1, 2, 3]]));
  return {
    httpEmbed: httpEmbedMock as unknown as EmbedderDeps["httpEmbed"],
    createLocalEmbedder: vi.fn(() => stubEmbed),
    httpEmbedMock,
  };
}

describe("makeEmbedder", () => {
  it("returns the deterministic stub embedder unchanged", () => {
    expect(makeEmbedder("deterministic")).toBe(stubEmbed);
  });

  it("routes the http engine through createEmbedder with the given model/baseUrl/apiKey", async () => {
    const deps = fakeDeps();
    const embed = makeEmbedder(
      "http",
      { model: "openai/text-embedding-3-small", baseUrl: "https://openrouter.ai/api/v1", apiKey: "sk-test" },
      deps,
    );

    await embed(["hello"], "document");

    expect(deps.httpEmbedMock).toHaveBeenCalledWith(
      ["hello"],
      "openai/text-embedding-3-small",
      "https://openrouter.ai/api/v1",
      "sk-test",
    );
  });

  it("throws a clear error when the http engine is selected without params", () => {
    expect(() => makeEmbedder("http")).toThrow(/http/i);
  });

  it("exposes sensible http engine defaults for the bench entry point to fall back to", () => {
    expect(DEFAULT_HTTP_EMBEDDING_MODEL).toBe("openai/text-embedding-3-small");
    expect(DEFAULT_HTTP_BASE_URL).toBe("https://openrouter.ai/api/v1");
  });
});
