import { describe, it, expect, vi } from "vitest";
import { queryAgent } from "./query.js";
import type { AgentProvider } from "./provider.js";

function makeMockProvider(response: string): AgentProvider {
  return {
    createAgent: vi.fn().mockResolvedValue({ agentId: "agent-abc" }),
    deleteAgent: vi.fn().mockResolvedValue(undefined),
    storePassage: vi.fn().mockResolvedValue("passage-1"),
    sendMessage: vi.fn().mockResolvedValue(response),
  };
}

describe("queryAgent", () => {
  it("sends a question and returns provider response", async () => {
    const provider = makeMockProvider("The auth uses JWT tokens.");
    const answer = await queryAgent(provider, "agent-123", "How does auth work?");
    expect(answer).toBe("The auth uses JWT tokens.");

    const sendMessage = provider.sendMessage as ReturnType<typeof vi.fn>;
    expect(sendMessage).toHaveBeenCalledWith("agent-123", "How does auth work?");
  });

  it("returns empty string when provider returns empty", async () => {
    const provider = makeMockProvider("");
    const answer = await queryAgent(provider, "agent-123", "test");
    expect(answer).toBe("");
  });
});
