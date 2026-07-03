import { describe, expect, it } from "vitest";
import { checkMcpEntry, generateMcpEntry } from "./mcp-config.js";

const MCP_SERVER_PATH = "/abs/path/mcp-server.ts";
const MODEL = "qwen3-coder:30b";
const BASE_URL = "http://localhost:11434/v1";
const VIKING_URL = "http://localhost:1933";

describe("generateMcpEntry", () => {
  it("writes LLM and Viking env when configured", () => {
    const entry = generateMcpEntry(MCP_SERVER_PATH, {
      model: MODEL,
      baseUrl: BASE_URL,
      vikingUrl: VIKING_URL,
      llmApiKey: "sk-test",
      vikingApiKey: "vk-key",
    });

    expect(entry.command).toBe("npx");
    expect(entry.args).toEqual(["tsx", MCP_SERVER_PATH]);
    expect(entry.timeout).toBe(300);
    expect(entry.env.LLM_MODEL).toBe(MODEL);
    expect(entry.env.LLM_BASE_URL).toBe(BASE_URL);
    expect(entry.env.VIKING_URL).toBe(VIKING_URL);
    expect(entry.env.LLM_API_KEY).toBe("sk-test");
    expect(entry.env.VIKING_API_KEY).toBe("vk-key");
    expect(entry.env.PROVIDER_TYPE).toBeUndefined();
    expect(entry.env.LETTA_API_KEY).toBeUndefined();
    expect(entry.env.OPENROUTER_API_KEY).toBeUndefined();
  });

  it("keeps defaults and omits missing API keys", () => {
    const entry = generateMcpEntry("/path", { model: MODEL });

    expect(entry.env.LLM_MODEL).toBe(MODEL);
    expect(entry.env.LLM_BASE_URL).toBe(BASE_URL);
    expect(entry.env.VIKING_URL).toBe(VIKING_URL);
    expect(entry.env.LLM_API_KEY).toBeUndefined();
    expect(entry.env.VIKING_API_KEY).toBeUndefined();
  });
});

describe("checkMcpEntry", () => {
  const providerConfig = {
    model: MODEL,
    baseUrl: BASE_URL,
    vikingUrl: VIKING_URL,
    llmApiKey: "sk-test",
  } as const;
  const validEntry = generateMcpEntry(MCP_SERVER_PATH, providerConfig);

  it("returns ok for a valid entry", () => {
    const result = checkMcpEntry(validEntry, MCP_SERVER_PATH, providerConfig);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("reports missing entry", () => {
    const result = checkMcpEntry(undefined, "/path", providerConfig);
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain('No "repo-expert" entry');
  });

  it("reports missing LLM_MODEL", () => {
    const entry = { ...validEntry, env: { LLM_BASE_URL: BASE_URL, VIKING_URL } };
    const result = checkMcpEntry(entry, MCP_SERVER_PATH, { baseUrl: BASE_URL, vikingUrl: VIKING_URL });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("LLM_MODEL is missing")]));
  });

  it("reports LLM_MODEL mismatch", () => {
    const entry = { ...validEntry, env: { ...validEntry.env, LLM_MODEL: "llama3.1:8b" } };
    const result = checkMcpEntry(entry, MCP_SERVER_PATH, providerConfig);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("LLM_MODEL mismatch")]));
  });

  it("reports LLM_BASE_URL mismatch", () => {
    const entry = { ...validEntry, env: { ...validEntry.env, LLM_BASE_URL: "https://openrouter.ai/api/v1" } };
    const result = checkMcpEntry(entry, MCP_SERVER_PATH, providerConfig);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("LLM_BASE_URL mismatch")]));
  });

  it("reports VIKING_URL mismatch", () => {
    const entry = { ...validEntry, env: { ...validEntry.env, VIKING_URL: "http://localhost:9999" } };
    const result = checkMcpEntry(entry, MCP_SERVER_PATH, providerConfig);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("VIKING_URL mismatch")]));
  });

  it("reports low timeout", () => {
    const entry = { ...validEntry, timeout: 30 };
    const result = checkMcpEntry(entry, MCP_SERVER_PATH, providerConfig);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("Timeout")]));
  });
});

describe("mcp binary mode", () => {
  it("validates binary command", () => {
    const binaryPath = "/dist/repo-expert-mcp";
    const providerConfig = { model: MODEL, baseUrl: BASE_URL, vikingUrl: VIKING_URL } as const;
    const entry = generateMcpEntry("/path/mcp-server.ts", providerConfig, binaryPath);
    expect(checkMcpEntry(entry, "/path/mcp-server.ts", providerConfig, binaryPath).ok).toBe(true);
  });
});
