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

  it("reports missing base URL", () => {
    const entry = { ...validEntry, env: { LETTA_API_KEY: "sk-test" } };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts");
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("LETTA_BASE_URL is missing")]));
  });

  it("reports wrong first arg (not tsx)", () => {
    const entry = { ...validEntry, args: ["node", "/abs/path/mcp-server.ts"] };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts");
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("tsx")]));
  });

  it("timeout exactly 60 is not flagged", () => {
    const entry = { ...validEntry, timeout: 60 };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts");
    expect(result.issues).not.toEqual(expect.arrayContaining([expect.stringContaining("Timeout")]));
  });

  it("timeout 59 is flagged", () => {
    const entry = { ...validEntry, timeout: 59 };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts");
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining("Timeout")]));
  });

  it("reports wrong first arg with actual value (not the fallback)", () => {
    const entry = { ...validEntry, args: ["node", "/abs/path/mcp-server.ts"] };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts");
    const argIssue = result.issues.find((i) => i.includes("First arg"));
    expect(argIssue).toBeDefined();
    expect(argIssue).toContain('"node"');
    expect(argIssue).not.toContain("(missing)");
  });

  it("handles entry with undefined env (optional chaining)", () => {
    const entry = { command: "npx", args: ["tsx", "/path"], timeout: 300 } as any;
    const result = checkMcpEntry(entry, "/path");
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("handles entry with missing args (covers args ?? [], args[0] ?? \"(missing)\", args[1] ?? \"\" fallbacks)", () => {
    const entry = { command: "npx", timeout: 300, env: validEntry.env } as any;
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts");
    expect(result.issues.some((i) => i.includes("(missing)"))).toBe(true);
    expect(result.issues.some((i) => i.includes('has ""'))).toBe(true);
  });


  it("timeout issue message includes actual timeout value", () => {
    const entry = { ...validEntry, timeout: 45 };
    const result = checkMcpEntry(entry, "/abs/path/mcp-server.ts");
    const timeoutIssue = result.issues.find((i) => i.includes("Timeout"));
    expect(timeoutIssue).toBeDefined();
    expect(timeoutIssue).toContain("45s");
  });
});
