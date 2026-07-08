import { describe, expect, it } from "vitest";
import { checkMcpEntry, generateMcpEntry, resolveMcpLaunchSpec, type McpLaunchSpec } from "./mcp-config.js";

const DEV_SERVER_PATH = "/abs/path/mcp-server.ts";
const DEV_LAUNCH: McpLaunchSpec = { kind: "dev", serverPath: DEV_SERVER_PATH };
const MODEL = "qwen3-coder:30b";
const BASE_URL = "http://localhost:11434/v1";
const EMBEDDING_MODEL = "nomic-embed-text";

describe("resolveMcpLaunchSpec", () => {
  it("prefers the SEA binary when provided", () => {
    const spec = resolveMcpLaunchSpec("/repo/src/cli.ts", "/repo/dist/repo-expert-mcp");
    expect(spec).toEqual({ kind: "sea-binary", binaryPath: "/repo/dist/repo-expert-mcp" });
  });

  it("resolves the bundled sibling mcp-server.mjs when running from the built cli.mjs", () => {
    const spec = resolveMcpLaunchSpec("/usr/lib/node_modules/repo-expert/dist/bin/cli.mjs");
    expect(spec).toEqual({
      kind: "bundled",
      serverScriptPath: "/usr/lib/node_modules/repo-expert/dist/bin/mcp-server.mjs",
    });
  });

  it("treats .js and .cjs entry points as bundled output", () => {
    expect(resolveMcpLaunchSpec("/x/dist/bin/cli.js").kind).toBe("bundled");
    expect(resolveMcpLaunchSpec("/x/dist/bin/cli.cjs").kind).toBe("bundled");
  });

  it("resolves the sibling mcp-server.ts when running from source via tsx", () => {
    const spec = resolveMcpLaunchSpec("/repo/src/cli.ts");
    expect(spec).toEqual({ kind: "dev", serverPath: "/repo/src/mcp-server.ts" });
  });
});

describe("generateMcpEntry", () => {
  it("writes LLM env when configured", () => {
    const entry = generateMcpEntry(DEV_LAUNCH, {
      model: MODEL,
      baseUrl: BASE_URL,
      embeddingModel: "mxbai-embed-large",
      llmApiKey: "sk-test",
    });

    expect(entry.command).toBe("npx");
    expect(entry.args).toEqual(["tsx", DEV_SERVER_PATH]);
    expect(entry.timeout).toBe(300);
    expect(entry.env.LLM_MODEL).toBe(MODEL);
    expect(entry.env.LLM_BASE_URL).toBe(BASE_URL);
    expect(entry.env.LLM_EMBEDDING_MODEL).toBe("mxbai-embed-large");
    expect(entry.env.LLM_API_KEY).toBe("sk-test");
    expect(entry.env.PROVIDER_TYPE).toBeUndefined();
    expect(entry.env.LETTA_API_KEY).toBeUndefined();
    expect(entry.env.OPENROUTER_API_KEY).toBeUndefined();
  });

  it("keeps defaults and omits missing API keys", () => {
    const entry = generateMcpEntry(DEV_LAUNCH, { model: MODEL });

    expect(entry.env.LLM_MODEL).toBe(MODEL);
    expect(entry.env.LLM_BASE_URL).toBe(BASE_URL);
    expect(entry.env.LLM_EMBEDDING_ENGINE).toBe("http");
    expect(entry.env.LLM_EMBEDDING_MODEL).toBe(EMBEDDING_MODEL);
    expect(entry.env.LLM_API_KEY).toBeUndefined();
  });

  it("writes LLM_EMBEDDING_ENGINE when configured", () => {
    const entry = generateMcpEntry(DEV_LAUNCH, { model: MODEL, embeddingEngine: "transformersjs" });
    expect(entry.env.LLM_EMBEDDING_ENGINE).toBe("transformersjs");
  });

  it("launches the bundled server with node, not npx tsx", () => {
    const launch: McpLaunchSpec = { kind: "bundled", serverScriptPath: "/global/repo-expert/dist/bin/mcp-server.mjs" };
    const entry = generateMcpEntry(launch, { model: MODEL });

    expect(entry.command).toBe("node");
    expect(entry.args).toEqual(["/global/repo-expert/dist/bin/mcp-server.mjs"]);
    expect(entry.timeout).toBe(300);
  });

  it("launches the SEA binary directly", () => {
    const launch: McpLaunchSpec = { kind: "sea-binary", binaryPath: "/dist/repo-expert-mcp" };
    const entry = generateMcpEntry(launch, { model: MODEL });

    expect(entry.command).toBe("/dist/repo-expert-mcp");
    expect(entry.args).toEqual([]);
  });
});

describe("checkMcpEntry", () => {
  const providerConfig = {
    model: MODEL,
    baseUrl: BASE_URL,
    embeddingModel: EMBEDDING_MODEL,
    llmApiKey: "sk-test",
  } as const;
  const validEntry = generateMcpEntry(DEV_LAUNCH, providerConfig);

  it("returns ok for a valid entry", () => {
    const result = checkMcpEntry(validEntry, DEV_LAUNCH, providerConfig);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("reports missing entry", () => {
    const result = checkMcpEntry(undefined, DEV_LAUNCH, providerConfig);
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain('No "repo-expert" entry');
  });

  it("reports missing LLM_MODEL", () => {
    const entry = { ...validEntry, env: { LLM_BASE_URL: BASE_URL } };
    const result = checkMcpEntry(entry, DEV_LAUNCH, { baseUrl: BASE_URL });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("LLM_MODEL is missing")]));
  });

  it("reports LLM_MODEL mismatch", () => {
    const entry = { ...validEntry, env: { ...validEntry.env, LLM_MODEL: "llama3.1:8b" } };
    const result = checkMcpEntry(entry, DEV_LAUNCH, providerConfig);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("LLM_MODEL mismatch")]));
  });

  it("reports LLM_BASE_URL mismatch", () => {
    const entry = { ...validEntry, env: { ...validEntry.env, LLM_BASE_URL: "https://openrouter.ai/api/v1" } };
    const result = checkMcpEntry(entry, DEV_LAUNCH, providerConfig);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("LLM_BASE_URL mismatch")]));
  });

  it("reports LLM_EMBEDDING_MODEL mismatch", () => {
    const entry = { ...validEntry, env: { ...validEntry.env, LLM_EMBEDDING_MODEL: "other-embedder" } };
    const result = checkMcpEntry(entry, DEV_LAUNCH, providerConfig);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("LLM_EMBEDDING_MODEL mismatch")]));
  });

  it("reports LLM_EMBEDDING_ENGINE mismatch", () => {
    const transformersConfig = { ...providerConfig, embeddingEngine: "transformersjs" };
    const result = checkMcpEntry(validEntry, DEV_LAUNCH, transformersConfig);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("LLM_EMBEDDING_ENGINE mismatch")]));
  });

  it("reports low timeout", () => {
    const entry = { ...validEntry, timeout: 30 };
    const result = checkMcpEntry(entry, DEV_LAUNCH, providerConfig);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("Timeout")]));
  });

  it("validates a bundled entry and flags a stale dev-style entry", () => {
    const launch: McpLaunchSpec = { kind: "bundled", serverScriptPath: "/global/dist/bin/mcp-server.mjs" };
    const bundledEntry = generateMcpEntry(launch, providerConfig);
    expect(checkMcpEntry(bundledEntry, launch, providerConfig).ok).toBe(true);

    const staleDevEntry = generateMcpEntry(DEV_LAUNCH, providerConfig);
    const result = checkMcpEntry(staleDevEntry, launch, providerConfig);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining('"node"')]));
  });

  it("validates binary command", () => {
    const launch: McpLaunchSpec = { kind: "sea-binary", binaryPath: "/dist/repo-expert-mcp" };
    const config = { model: MODEL, baseUrl: BASE_URL, embeddingModel: EMBEDDING_MODEL } as const;
    const entry = generateMcpEntry(launch, config);
    expect(checkMcpEntry(entry, launch, config).ok).toBe(true);
  });
});
