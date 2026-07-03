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
    expect(result.error).toContain("model unavailable");
    expect(logged.join("\n")).toContain("memory consolidation failed");
  });
});
