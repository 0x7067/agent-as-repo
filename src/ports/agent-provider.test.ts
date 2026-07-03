import { describe, it, expect } from "vitest";

describe("AgentProvider port", () => {
  it("can be imported from src/ports/agent-provider", async () => {
    const mod = await import("./agent-provider.js");
    expect(mod).toBeDefined();
  });
});
