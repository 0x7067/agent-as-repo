import { describe, it, expect, vi } from "vitest";
import { roundRobin, supervisorFanOut } from "./group-provider.js";
import type { AgentProvider } from "./provider.js";
import type { RoundRobinConfig, SupervisorConfig } from "./group-provider.js";

function makeMockProvider(): AgentProvider {
  return {
    createAgent: vi.fn().mockResolvedValue({ agentId: "agent-abc" }),
    deleteAgent: vi.fn().mockResolvedValue(undefined),
    deletePassage: vi.fn().mockResolvedValue(undefined),
    listPassages: vi.fn().mockResolvedValue([]),
    getBlock: vi.fn().mockResolvedValue({ value: "", limit: 5000 }),
    storePassage: vi.fn().mockResolvedValue("p-new"),
    sendMessage: vi.fn().mockResolvedValue("response"),
  };
}

describe("roundRobin", () => {
  it("sends message to each agent up to maxTurns", async () => {
    const provider = makeMockProvider();
    const config: RoundRobinConfig = {
      type: "round_robin",
      agentIds: ["a1", "a2", "a3"],
      maxTurns: 2,
    };

    const results = await roundRobin(provider, config, "What is this?");

    expect(results).toHaveLength(2);
    expect(provider.sendMessage).toHaveBeenCalledTimes(2);
    expect(provider.sendMessage).toHaveBeenCalledWith("a1", "What is this?");
    expect(provider.sendMessage).toHaveBeenCalledWith("a2", "What is this?");
  });

  it("limits turns to number of agents", async () => {
    const provider = makeMockProvider();
    const config: RoundRobinConfig = {
      type: "round_robin",
      agentIds: ["a1"],
      maxTurns: 5,
    };

    const results = await roundRobin(provider, config, "hello");

    expect(results).toHaveLength(1);
  });
});

describe("supervisorFanOut", () => {
  it("fans out to workers then summarizes via manager", async () => {
    const provider = makeMockProvider();
    (provider.sendMessage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("worker-1 answer")
      .mockResolvedValueOnce("worker-2 answer")
      .mockResolvedValueOnce("synthesized summary");

    const config: SupervisorConfig = {
      type: "supervisor",
      managerAgentId: "manager-1",
      workerAgentIds: ["w1", "w2"],
    };

    const result = await supervisorFanOut(provider, config, "Explain auth");

    expect(result).toBe("synthesized summary");
    // Workers called with original content
    expect(provider.sendMessage).toHaveBeenCalledWith("w1", "Explain auth");
    expect(provider.sendMessage).toHaveBeenCalledWith("w2", "Explain auth");
    // Manager called with synthesized worker responses
    expect(provider.sendMessage).toHaveBeenCalledWith(
      "manager-1",
      expect.stringContaining("worker-1 answer"),
    );
    expect(provider.sendMessage).toHaveBeenCalledWith(
      "manager-1",
      expect.stringContaining("worker-2 answer"),
    );
  });
});
