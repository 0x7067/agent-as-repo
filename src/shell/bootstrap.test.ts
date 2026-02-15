import { describe, it, expect, vi } from "vitest";
import { bootstrapAgent } from "./bootstrap.js";
import type { AgentProvider } from "./provider.js";

function makeMockProvider(): AgentProvider {
  return {
    createAgent: vi.fn().mockResolvedValue({ agentId: "agent-abc" }),
    deleteAgent: vi.fn().mockResolvedValue(undefined),
    deletePassage: vi.fn().mockResolvedValue(undefined),
    listPassages: vi.fn().mockResolvedValue([]),
    getBlock: vi.fn().mockResolvedValue({ value: "", limit: 5000 }),
    storePassage: vi.fn().mockResolvedValue("passage-1"),
    sendMessage: vi.fn().mockResolvedValue("Updated."),
  };
}

describe("bootstrapAgent", () => {
  it("sends architecture and conventions bootstrap prompts", async () => {
    const provider = makeMockProvider();
    await bootstrapAgent(provider, "agent-123");
    const sendMessage = provider.sendMessage as ReturnType<typeof vi.fn>;
    expect(sendMessage).toHaveBeenCalledTimes(2);

    expect(sendMessage.mock.calls[0][0]).toBe("agent-123");
    expect(sendMessage.mock.calls[0][1]).toContain("architecture");

    expect(sendMessage.mock.calls[1][1]).toContain("conventions");
  });
});
