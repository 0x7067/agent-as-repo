import { describe, it, expect, vi } from "vitest";
import { exportAgent } from "./export.js";
import type { AgentProvider } from "./provider.js";

function makeMockProvider(): AgentProvider {
  return {
    createAgent: vi.fn().mockResolvedValue({ agentId: "agent-abc" }),
    deleteAgent: vi.fn().mockResolvedValue(undefined),
    deletePassage: vi.fn().mockResolvedValue(undefined),
    listPassages: vi.fn().mockResolvedValue([
      { id: "p-1", text: "FILE: src/index.ts\nconst x = 1;" },
      { id: "p-2", text: "FILE: src/app.tsx\nexport default App;" },
      { id: "p-3", text: "FILE: src/index.ts\nfunction main() {}" },
    ]),
    getBlock: vi.fn().mockImplementation(async (_agentId: string, label: string) => {
      const blocks: Record<string, { value: string; limit: number }> = {
        persona: { value: "I am a repo expert.", limit: 5000 },
        architecture: { value: "Uses React.", limit: 5000 },
        conventions: { value: "ESLint.", limit: 5000 },
      };
      return blocks[label] ?? { value: "", limit: 5000 };
    }),
    storePassage: vi.fn().mockResolvedValue("p-new"),
    sendMessage: vi.fn().mockResolvedValue("Done."),
  };
}

describe("exportAgent", () => {
  it("fetches blocks and passages, returns formatted markdown", async () => {
    const provider = makeMockProvider();

    const md = await exportAgent(provider, "my-app", "agent-abc");

    expect(md).toContain("# my-app");
    expect(md).toContain("agent-abc");
    expect(md).toContain("I am a repo expert.");
    expect(md).toContain("Uses React.");
    expect(md).toContain("ESLint.");
    expect(md).toContain("Files (2)");
    expect(md).toContain("`src/index.ts`");
    expect(md).toContain("`src/app.tsx`");
    expect(provider.listPassages).toHaveBeenCalledWith("agent-abc");
    expect(provider.getBlock).toHaveBeenCalledTimes(3);
  });

  it("deduplicates file paths from multiple passages", async () => {
    const provider = makeMockProvider();

    const md = await exportAgent(provider, "my-app", "agent-abc");

    // src/index.ts appears in 2 passages but should only be listed once
    const matches = md.match(/src\/index\.ts/g);
    expect(matches).toHaveLength(1);
  });
});
