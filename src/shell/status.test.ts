import { describe, it, expect, vi } from "vitest";
import { getAgentStatus } from "./status.js";
import type { AgentState } from "../core/types.js";
import { makeMockProvider } from "./__test__/mock-provider.js";

function makeStatusProvider() {
  return makeMockProvider({
    listPassages: vi.fn().mockResolvedValue([
      { id: "p-1", text: "file content" },
      { id: "p-2", text: "file content" },
    ]),
    getBlock: vi.fn().mockImplementation(async (_agentId: string, label: string) => {
      const blocks: Record<string, { value: string; limit: number }> = {
        persona: { value: "I am a repo expert.", limit: 5000 },
        architecture: { value: "Uses React.", limit: 5000 },
        conventions: { value: "ESLint.", limit: 5000 },
      };
      return blocks[label] ?? { value: "", limit: 5000 };
    }),
  });
}

const testAgent: AgentState = {
  agentId: "agent-abc",
  repoName: "my-app",
  passages: { "src/a.ts": ["p-1"], "src/b.ts": ["p-2"] },
  lastBootstrap: "2026-01-01T00:00:00.000Z",
  lastSyncCommit: "abc1234",
  lastSyncAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("getAgentStatus", () => {
  it("fetches blocks and passages and returns formatted status", async () => {
    const provider = makeStatusProvider();

    const output = await getAgentStatus(provider, "my-app", testAgent);

    expect(output).toContain("my-app");
    expect(output).toContain("agent-abc");
    expect(output).toContain("persona");
    expect(output).toContain("19/5000");
    expect(output).toContain("architecture");
    expect(output).toContain("11/5000");
    expect(output).toContain("abc1234");
    expect(provider.listPassages).toHaveBeenCalledWith("agent-abc");
    expect(provider.getBlock).toHaveBeenCalledTimes(3);
  });
});
