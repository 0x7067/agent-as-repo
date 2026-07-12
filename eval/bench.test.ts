import { afterEach, describe, it, expect } from "vitest";
import { runBench, evaluateGates, parseArgs, resolveHttpEngineParams } from "./bench.js";
import { DEFAULT_HTTP_BASE_URL, DEFAULT_HTTP_EMBEDDING_MODEL } from "./bench-pipeline.js";

/**
 * Smoke test so the bench script can't rot: it runs the whole pipeline
 * (copy fixture -> git init -> collect -> chunk -> store -> searchLegs -> score)
 * in-process on a small slice of gold queries. Not the full benchmark (that is
 * `pnpm bench`); this only guards executability and report shape.
 */
describe("bench smoke", () => {
  it("runs end to end on a small query slice and produces a well-formed report", async () => {
    const { report, gatesPassed } = await runBench({ limit: 3, quiet: true });

    expect(report.engine).toBe("deterministic");
    expect(report.queryCount).toBe(3);
    expect(report.performance.passageCount).toBeGreaterThan(0);
    expect(report.performance.chunkCount).toBe(report.performance.passageCount);

    // The first three gold queries are all identifiers; identifier Recall@1
    // must be a perfect 1.0 (the hybrid guarantee).
    expect(report.legs.fused.recallAt1.byKind["identifier"]).toBe(1);
    expect(gatesPassed).toBe(true);
  }, 30_000);

  it("evaluateGates reports the three deterministic-tier gates", async () => {
    const { report } = await runBench({ limit: 5, quiet: true });
    const gates = evaluateGates(report);

    expect(gates.lines).toHaveLength(3);
    expect(gates.passed).toBe(true);
  }, 30_000);
});

describe("parseArgs", () => {
  it("parses --engine http alongside --model and --base-url overrides", () => {
    const options = parseArgs([
      "--engine",
      "http",
      "--model",
      "openai/text-embedding-3-large",
      "--base-url",
      "https://example.com/v1",
    ]);

    expect(options).toEqual({
      engine: "http",
      model: "openai/text-embedding-3-large",
      baseUrl: "https://example.com/v1",
    });
  });

  it("still parses --engine transformersjs (unaffected by the http addition)", () => {
    expect(parseArgs(["--engine", "transformersjs"])).toEqual({ engine: "transformersjs" });
  });

  it("ignores an unrecognized --engine value (unchanged behavior)", () => {
    expect(parseArgs(["--engine", "bogus"])).toEqual({});
  });

  it("leaves model/baseUrl unset when not passed (deterministic default path stays byte-identical)", () => {
    expect(parseArgs([])).toEqual({});
  });
});

describe("resolveHttpEngineParams", () => {
  const ORIGINAL_API_KEY = process.env["LLM_API_KEY"];
  const ORIGINAL_BASE_URL = process.env["LLM_BASE_URL"];

  afterEach(() => {
    if (ORIGINAL_API_KEY === undefined) delete process.env["LLM_API_KEY"];
    else process.env["LLM_API_KEY"] = ORIGINAL_API_KEY;
    if (ORIGINAL_BASE_URL === undefined) delete process.env["LLM_BASE_URL"];
    else process.env["LLM_BASE_URL"] = ORIGINAL_BASE_URL;
  });

  it("fails fast with a clear message when LLM_API_KEY is unset", () => {
    delete process.env["LLM_API_KEY"];
    expect(() => resolveHttpEngineParams({ engine: "http" })).toThrow(/LLM_API_KEY/);
  });

  it("fails fast when LLM_API_KEY is set but empty", () => {
    process.env["LLM_API_KEY"] = "  ";
    expect(() => resolveHttpEngineParams({ engine: "http" })).toThrow(/LLM_API_KEY/);
  });

  it("defaults model to openai/text-embedding-3-small and base-url to OpenRouter when unset", () => {
    process.env["LLM_API_KEY"] = "sk-test";
    delete process.env["LLM_BASE_URL"];
    expect(resolveHttpEngineParams({ engine: "http" })).toEqual({
      model: DEFAULT_HTTP_EMBEDDING_MODEL,
      baseUrl: DEFAULT_HTTP_BASE_URL,
      apiKey: "sk-test",
    });
  });

  it("prefers LLM_BASE_URL from the environment over the OpenRouter default", () => {
    process.env["LLM_API_KEY"] = "sk-test";
    process.env["LLM_BASE_URL"] = "https://env-default.example/v1";
    expect(resolveHttpEngineParams({ engine: "http" }).baseUrl).toBe("https://env-default.example/v1");
  });

  it("--model/--base-url flags override both the env var and the defaults", () => {
    process.env["LLM_API_KEY"] = "sk-test";
    process.env["LLM_BASE_URL"] = "https://env-default.example/v1";
    const params = resolveHttpEngineParams({
      engine: "http",
      model: "openai/text-embedding-3-large",
      baseUrl: "https://flag.example/v1",
    });
    expect(params).toEqual({
      model: "openai/text-embedding-3-large",
      baseUrl: "https://flag.example/v1",
      apiKey: "sk-test",
    });
  });
});

describe("runBench with --engine http", () => {
  const ORIGINAL_API_KEY = process.env["LLM_API_KEY"];

  afterEach(() => {
    if (ORIGINAL_API_KEY === undefined) delete process.env["LLM_API_KEY"];
    else process.env["LLM_API_KEY"] = ORIGINAL_API_KEY;
  });

  it("fails fast (no network access, no indexing) when LLM_API_KEY is missing", async () => {
    delete process.env["LLM_API_KEY"];
    await expect(runBench({ engine: "http", limit: 1, quiet: true })).rejects.toThrow(/LLM_API_KEY/);
  });
});
