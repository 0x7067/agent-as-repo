import { describe, it, expect, vi } from "vitest";
import { consolidateAgentMemory } from "./consolidate.js";
import { makeMockProvider } from "./__test__/mock-provider.js";

describe("consolidateAgentMemory", () => {
  const syncResult = { filesReIndexed: 4, filesRemoved: 1 };

  it("reads the current blocks and runs one consolidation turn on success", async () => {
    const getBlock = vi.fn().mockImplementation((_agentId: string, label: string) =>
      Promise.resolve({ value: `current-${label}`, limit: 5000 }),
    );
    const consolidateMemory = vi.fn().mockResolvedValue("done");
    const provider = makeMockProvider({ getBlock, consolidateMemory });

    const result = await consolidateAgentMemory({
      provider,
      agentId: "agent-1",
      changedFiles: ["src/a.ts"],
      syncResult,
      blockCharLimit: 5000,
    });

    expect(result.consolidated).toBe(true);
    expect(consolidateMemory).toHaveBeenCalledTimes(1);
    const [agentId, prompt, options] = consolidateMemory.mock.calls[0] as [string, string, { blockCharLimit?: number }];
    expect(agentId).toBe("agent-1");
    expect(prompt).toContain("current-architecture");
    expect(prompt).toContain("current-conventions");
    expect(prompt).toContain("- src/a.ts");
    expect(options.blockCharLimit).toBe(5000);
  });

  it("swallows provider failures and reports them without throwing", async () => {
    const consolidateMemory = vi.fn().mockRejectedValue(new Error("model unavailable"));
    const logged: string[] = [];
    const provider = makeMockProvider({ consolidateMemory });

    const result = await consolidateAgentMemory({
      provider,
      agentId: "agent-1",
      changedFiles: [],
      syncResult,
      blockCharLimit: 5000,
      log: (m) => logged.push(m),
    });

    expect(result.consolidated).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.error).toContain("model unavailable");
    expect(logged.join("\n")).toContain("memory consolidation failed");
  });

  it("reports changed: false and logs a no-op when the blocks are identical before and after", async () => {
    const getBlock = vi.fn().mockResolvedValue({ value: "same content", limit: 5000 });
    const consolidateMemory = vi.fn().mockResolvedValue();
    const logged: string[] = [];
    const provider = makeMockProvider({ getBlock, consolidateMemory });

    const result = await consolidateAgentMemory({
      provider,
      agentId: "agent-1",
      changedFiles: ["src/a.ts"],
      syncResult,
      blockCharLimit: 5000,
      log: (m) => logged.push(m),
    });

    expect(result.consolidated).toBe(true);
    expect(result.changed).toBe(false);
    expect(logged.join("\n")).toContain("consolidation: blocks unchanged");
  });

  it("reports changed: true when the blocks differ after the consolidation turn", async () => {
    let callCount = 0;
    const getBlock = vi.fn().mockImplementation((_agentId: string, label: string) => {
      callCount++;
      // First pass (pre-hash): original content. Second pass (post-hash): rewritten.
      const value = callCount <= 2 ? `original-${label}` : `revised-${label}`;
      return Promise.resolve({ value, limit: 5000 });
    });
    const consolidateMemory = vi.fn().mockResolvedValue();
    const logged: string[] = [];
    const provider = makeMockProvider({ getBlock, consolidateMemory });

    const result = await consolidateAgentMemory({
      provider,
      agentId: "agent-1",
      changedFiles: ["src/a.ts"],
      syncResult,
      blockCharLimit: 5000,
      log: (m) => logged.push(m),
    });

    expect(result.consolidated).toBe(true);
    expect(result.changed).toBe(true);
    expect(logged.join("\n")).not.toContain("blocks unchanged");
  });

  it("reports per-block modified/unchanged status when only one block changes", async () => {
    let callCount = 0;
    const getBlock = vi.fn().mockImplementation((_agentId: string, label: string) => {
      callCount++;
      const isPost = callCount > 2;
      if (label === "architecture") {
        return Promise.resolve({ value: isPost ? "revised-architecture" : "original-architecture", limit: 5000 });
      }
      return Promise.resolve({ value: "same-conventions", limit: 5000 });
    });
    const consolidateMemory = vi.fn().mockResolvedValue();
    const logged: string[] = [];
    const provider = makeMockProvider({ getBlock, consolidateMemory });

    const result = await consolidateAgentMemory({
      provider,
      agentId: "agent-1",
      changedFiles: ["src/a.ts"],
      syncResult,
      blockCharLimit: 5000,
      log: (m) => logged.push(m),
    });

    expect(result.consolidated).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.blockChanges).toEqual([
      { label: "architecture", changed: true },
      { label: "conventions", changed: false },
    ]);
    expect(logged.join("\n")).toContain("architecture: modified");
    expect(logged.join("\n")).toContain("conventions: unchanged");
  });
});
