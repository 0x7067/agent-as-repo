import { describe, expect, it } from "vitest";
import { checkMcpEntry, generateMcpEntry } from "./mcp-config.js";

describe("generateMcpEntry (letta)", () => {
  it("produces a valid entry with npx tsx", () => {
    const entry = generateMcpEntry(
      "/abs/path/mcp-server.ts",
      { type: "letta", apiKey: "sk-test" },
    );
    expect(entry.command).toBe("npx");
    expect(entry.args).toEqual(["tsx", "/abs/path/mcp-server.ts"]);
    expect(entry.env.LETTA_BASE_URL).toBe("https://api.letta.com");
    expect(entry.env.LETTA_API_KEY).toBe("sk-test");
    expect(entry.timeout).toBe(300);
  });

  it("accepts custom base URL", () => {
    const entry = generateMcpEntry(
      "/path",
      { type: "letta", apiKey: "key", baseUrl: "https://custom.letta.com" },
    );
    expect(entry.env.LETTA_BASE_URL).toBe("https://custom.letta.com");
  });
});

describe("generateMcpEntry (viking)", () => {
  it("writes Viking/OpenRouter env vars", () => {
    const entry = generateMcpEntry(
      "/abs/path/mcp-server.ts",
      {
        type: "viking",
        openrouterApiKey: "or-key",
        openrouterModel: "openai/gpt-4o-mini",
        vikingUrl: "http://localhost:1933",
        vikingApiKey: "vk-key",
      },
    );
    expect(entry.command).toBe("npx");
    expect(entry.args).toEqual(["tsx", "/abs/path/mcp-server.ts"]);
    expect(entry.env.PROVIDER_TYPE).toBe("viking");
    expect(entry.env.OPENROUTER_API_KEY).toBe("or-key");
    expect(entry.env.OPENROUTER_MODEL).toBe("openai/gpt-4o-mini");
    expect(entry.env.VIKING_URL).toBe("http://localhost:1933");
    expect(entry.env.VIKING_API_KEY).toBe("vk-key");
  });
});

describe("checkMcpEntry (letta)", () => {
  const validEntry = generateMcpEntry("/abs/path/mcp-server.ts", { type: "letta", apiKey: "sk-test" });
  const provider = { type: "letta", apiKey: "sk-test", baseUrl: "https://api.letta.com" } as const;

  it("returns ok for a valid entry", () => {
    const result = checkMcpEntry(validEntry, "/abs/path/mcp-server.ts", provider);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("reports missing entry", () => {
    const result = checkMcpEntry(undefined, "/path", provider);
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain("No \"letta\" entry");
  });

  it("reports /v1 suffix in base URL", () => {
    const entry = { ...validEntry, env: { ...validEntry.env, LETTA_BASE_URL: "https://api.letta.com/v1" } };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts", provider);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("/v1")]));
  });

  it("reports missing API key", () => {
    const entry = { ...validEntry, env: { LETTA_BASE_URL: "https://api.letta.com" } };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts", provider);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("LETTA_API_KEY")]));
  });

  it("accepts LETTA_PASSWORD as alias", () => {
    const entry = { ...validEntry, env: { LETTA_BASE_URL: "https://api.letta.com", LETTA_PASSWORD: "sk-test" } };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts", provider);
    expect(result.issues).not.toEqual(expect.arrayContaining([expect.stringContaining("LETTA_API_KEY")]));
  });

  it("reports wrong command", () => {
    const entry = { ...validEntry, command: "tsx" };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts", provider);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("npx")]));
  });

  it("reports low timeout", () => {
    const entry = { ...validEntry, timeout: 30 };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts", provider);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("Timeout")]));
  });
});

describe("checkMcpEntry (viking)", () => {
  const provider = {
    type: "viking",
    openrouterApiKey: "or-key",
    openrouterModel: "openai/gpt-4o-mini",
    vikingUrl: "http://localhost:1933",
  } as const;
  const validEntry = generateMcpEntry("/abs/path/mcp-server.ts", provider);

  it("returns ok for a valid Viking entry", () => {
    const result = checkMcpEntry(validEntry, "/abs/path/mcp-server.ts", provider);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("reports missing provider type marker", () => {
    const entry = { ...validEntry, env: { ...validEntry.env, PROVIDER_TYPE: "" } };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts", provider);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("PROVIDER_TYPE")]));
  });

  it("reports missing OpenRouter API key", () => {
    const entry = { ...validEntry, env: { ...validEntry.env, OPENROUTER_API_KEY: "" } };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts", provider);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("OPENROUTER_API_KEY")]));
  });

  it("reports missing OpenRouter model", () => {
    const entry = { ...validEntry, env: { ...validEntry.env, OPENROUTER_MODEL: "" } };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts", provider);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("OPENROUTER_MODEL is missing")]));
  });

  it("reports OpenRouter model mismatch", () => {
    const entry = { ...validEntry, env: { ...validEntry.env, OPENROUTER_MODEL: "anthropic/claude-3-haiku" } };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts", provider);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("OPENROUTER_MODEL mismatch")]));
  });

  it("reports VIKING_URL mismatch when expected", () => {
    const entry = { ...validEntry, env: { ...validEntry.env, VIKING_URL: "http://localhost:9999" } };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts", provider);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("VIKING_URL mismatch")]));
  });
});

describe("mcp binary mode", () => {
  it("validates binary command for Letta and Viking", () => {
    const binaryPath = "/dist/letta-tools";
    const lettaEntry = generateMcpEntry(
      "/path/mcp-server.ts",
      { type: "letta", apiKey: "sk-test" },
      binaryPath,
    );
    const vikingEntry = generateMcpEntry(
      "/path/mcp-server.ts",
      { type: "viking", openrouterApiKey: "or-key", openrouterModel: "openai/gpt-4o-mini" },
      binaryPath,
    );

    expect(checkMcpEntry(lettaEntry, "/path/mcp-server.ts", { type: "letta", apiKey: "sk-test" }, binaryPath).ok).toBe(true);
    expect(checkMcpEntry(vikingEntry, "/path/mcp-server.ts", { type: "viking", openrouterApiKey: "or-key", openrouterModel: "openai/gpt-4o-mini" }, binaryPath).ok).toBe(true);
  });
});
