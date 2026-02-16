import { describe, it, expect, vi } from "vitest";
import { onboardAgent } from "./onboard.js";
import type { AgentProvider } from "./provider.js";

function makeMockProvider(): AgentProvider {
  return {
    createAgent: vi.fn().mockResolvedValue({ agentId: "agent-abc" }),
    deleteAgent: vi.fn().mockResolvedValue(undefined),
    deletePassage: vi.fn().mockResolvedValue(undefined),
    listPassages: vi.fn().mockResolvedValue([]),
    getBlock: vi.fn().mockResolvedValue({ value: "", limit: 5000 }),
    storePassage: vi.fn().mockResolvedValue("p-new"),
    sendMessage: vi.fn().mockResolvedValue("Welcome! Here is your onboarding guide..."),
  };
}

describe("onboardAgent", () => {
  it("sends onboarding prompt and returns response", async () => {
    const provider = makeMockProvider();

    const result = await onboardAgent(provider, "my-app", "agent-abc");

    expect(result).toBe("Welcome! Here is your onboarding guide...");
    expect(provider.sendMessage).toHaveBeenCalledWith("agent-abc", expect.stringContaining("my-app"));
    expect(provider.sendMessage).toHaveBeenCalledWith("agent-abc", expect.stringContaining("Architecture"));
  });
});
