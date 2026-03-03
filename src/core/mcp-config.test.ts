import { describe, expect, it } from "vitest";
import { checkMcpEntry, generateMcpEntry } from "./mcp-config.js";

const MCP_SERVER_PATH = "/abs/path/mcp-server.ts";
const LETTA_BASE_URL = "https://api.letta.com";
const OPENROUTER_MODEL = "openai/gpt-4o-mini";
const VIKING_URL = "http://localhost:1933";

describe("generateMcpEntry (unified)", () => {
  it("writes both Letta and Viking env when configured", () => {
    const entry = generateMcpEntry(MCP_SERVER_PATH, {
      preferredProvider: "letta",
      letta: { apiKey: "sk-test", baseUrl: LETTA_BASE_URL },
      viking: {
        openrouterApiKey: "or-key",
        openrouterModel: OPENROUTER_MODEL,
        vikingUrl: VIKING_URL,
        vikingApiKey: "vk-key",
      },
    });

    expect(entry.command).toBe("npx");
    expect(entry.args).toEqual(["tsx", MCP_SERVER_PATH]);
    expect(entry.timeout).toBe(300);
    expect(entry.env.PROVIDER_TYPE).toBe("letta");
    expect(entry.env.LETTA_BASE_URL).toBe(LETTA_BASE_URL);
    expect(entry.env.LETTA_API_KEY).toBe("sk-test");
    expect(entry.env.OPENROUTER_API_KEY).toBe("or-key");
    expect(entry.env.OPENROUTER_MODEL).toBe(OPENROUTER_MODEL);
    expect(entry.env.VIKING_URL).toBe(VIKING_URL);
    expect(entry.env.VIKING_API_KEY).toBe("vk-key");
  });

  it("keeps defaults and omits missing API keys", () => {
    const entry = generateMcpEntry("/path", {
      letta: { baseUrl: LETTA_BASE_URL },
      viking: { openrouterModel: OPENROUTER_MODEL },
    });

    expect(entry.env.LETTA_BASE_URL).toBe(LETTA_BASE_URL);
    expect(entry.env.OPENROUTER_MODEL).toBe(OPENROUTER_MODEL);
    expect(entry.env.VIKING_URL).toBe(VIKING_URL);
    expect(entry.env.LETTA_API_KEY).toBeUndefined();
    expect(entry.env.OPENROUTER_API_KEY).toBeUndefined();
  });
});

describe("checkMcpEntry (unified)", () => {
  const providerConfig = {
    preferredProvider: "letta",
    letta: { apiKey: "sk-test", baseUrl: LETTA_BASE_URL },
    viking: { openrouterApiKey: "or-key", openrouterModel: OPENROUTER_MODEL, vikingUrl: VIKING_URL },
  } as const;
  const validEntry = generateMcpEntry(MCP_SERVER_PATH, providerConfig);

  it("returns ok for valid unified entry", () => {
    const result = checkMcpEntry(validEntry, MCP_SERVER_PATH, providerConfig);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("reports missing entry", () => {
    const result = checkMcpEntry(undefined, "/path", providerConfig);
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain("No \"letta\" entry");
  });

  it("reports missing provider keys when neither key is present", () => {
    const entry = { ...validEntry, env: { LETTA_BASE_URL, OPENROUTER_MODEL } };
    const result = checkMcpEntry(entry, MCP_SERVER_PATH, { letta: { baseUrl: LETTA_BASE_URL }, viking: { openrouterModel: OPENROUTER_MODEL } });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("At least one provider key is required")]));
  });

  it("reports invalid PROVIDER_TYPE", () => {
    const entry = { ...validEntry, env: { ...validEntry.env, PROVIDER_TYPE: "unknown" } };
    const result = checkMcpEntry(entry, MCP_SERVER_PATH, providerConfig);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("PROVIDER_TYPE")]));
  });

  it("reports /v1 suffix in LETTA_BASE_URL", () => {
    const entry = { ...validEntry, env: { ...validEntry.env, LETTA_BASE_URL: `${LETTA_BASE_URL}/v1` } };
    const result = checkMcpEntry(entry, MCP_SERVER_PATH, providerConfig);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("/v1")]));
  });

  it("reports OPENROUTER_MODEL mismatch", () => {
    const entry = { ...validEntry, env: { ...validEntry.env, OPENROUTER_MODEL: "anthropic/claude-3-haiku" } };
    const result = checkMcpEntry(entry, MCP_SERVER_PATH, providerConfig);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("OPENROUTER_MODEL mismatch")]));
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
  it("validates binary command for unified env", () => {
    const binaryPath = "/dist/letta-tools";
    const providerConfig = {
      preferredProvider: "viking",
      letta: { apiKey: "sk-test" },
      viking: { openrouterApiKey: "or-key", openrouterModel: OPENROUTER_MODEL },
    } as const;
    const entry = generateMcpEntry("/path/mcp-server.ts", providerConfig, binaryPath);
    expect(checkMcpEntry(entry, "/path/mcp-server.ts", providerConfig, binaryPath).ok).toBe(true);
  });
});
