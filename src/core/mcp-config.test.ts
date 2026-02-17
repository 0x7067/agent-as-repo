import { describe, it, expect } from "vitest";
import { generateMcpEntry, checkMcpEntry } from "./mcp-config.js";

describe("generateMcpEntry", () => {
  it("produces a valid entry with npx tsx", () => {
    const entry = generateMcpEntry("/abs/path/mcp-server.ts", "sk-test");
    expect(entry.command).toBe("npx");
    expect(entry.args).toEqual(["tsx", "/abs/path/mcp-server.ts"]);
    expect(entry.env.LETTA_BASE_URL).toBe("https://api.letta.com");
    expect(entry.env.LETTA_API_KEY).toBe("sk-test");
    expect(entry.timeout).toBe(300);
  });

  it("accepts custom base URL", () => {
    const entry = generateMcpEntry("/path", "key", "https://custom.letta.com");
    expect(entry.env.LETTA_BASE_URL).toBe("https://custom.letta.com");
  });
});

describe("checkMcpEntry", () => {
  const validEntry = generateMcpEntry("/abs/path/mcp-server.ts", "sk-test");

  it("returns ok for a valid entry", () => {
    const result = checkMcpEntry(validEntry, "/abs/path/mcp-server.ts");
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("reports missing entry", () => {
    const result = checkMcpEntry(undefined, "/path");
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain("No \"letta\" entry");
  });

  it("reports /v1 suffix in base URL", () => {
    const entry = { ...validEntry, env: { ...validEntry.env, LETTA_BASE_URL: "https://api.letta.com/v1" } };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts");
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("/v1")]));
  });

  it("reports missing API key", () => {
    const entry = { ...validEntry, env: { LETTA_BASE_URL: "https://api.letta.com" } };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts");
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("LETTA_API_KEY")]));
  });

  it("accepts LETTA_PASSWORD as alias", () => {
    const entry = { ...validEntry, env: { LETTA_BASE_URL: "https://api.letta.com", LETTA_PASSWORD: "sk-test" } };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts");
    expect(result.issues).not.toEqual(expect.arrayContaining([expect.stringContaining("LETTA_API_KEY")]));
  });

  it("reports wrong command", () => {
    const entry = { ...validEntry, command: "tsx" };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts");
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("npx")]));
  });

  it("reports low timeout", () => {
    const entry = { ...validEntry, timeout: 30 };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts");
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("Timeout")]));
  });

  it("reports path mismatch", () => {
    const result = checkMcpEntry(validEntry, "/different/path.ts");
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("mismatch")]));
  });
});
