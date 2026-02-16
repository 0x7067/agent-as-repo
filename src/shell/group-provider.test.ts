import { describe, it, expect, vi } from "vitest";
import { roundRobin, supervisorFanOut, broadcastAsk } from "./group-provider.js";
import type { RoundRobinConfig, SupervisorConfig } from "./group-provider.js";
import { makeMockProvider } from "./__test__/mock-provider.js";

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

describe("broadcastAsk", () => {
  it("queries all agents and returns labeled results", async () => {
    const provider = makeMockProvider();
    (provider.sendMessage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("frontend answer")
      .mockResolvedValueOnce("backend answer");

    const agents = [
      { repoName: "mobile-app", agentId: "a1" },
      { repoName: "backend-api", agentId: "a2" },
    ];

    const results = await broadcastAsk(provider, agents, "How does auth work?");

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ repoName: "mobile-app", response: "frontend answer", error: null });
    expect(results[1]).toEqual({ repoName: "backend-api", response: "backend answer", error: null });
  });

  it("handles agent timeout gracefully", async () => {
    const provider = makeMockProvider();
    (provider.sendMessage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("fast answer")
      .mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 5000)));

    const agents = [
      { repoName: "fast-repo", agentId: "a1" },
      { repoName: "slow-repo", agentId: "a2" },
    ];

    const results = await broadcastAsk(provider, agents, "hello", { timeoutMs: 50 });

    expect(results[0]).toEqual({ repoName: "fast-repo", response: "fast answer", error: null });
    expect(results[1].repoName).toBe("slow-repo");
    expect(results[1].response).toBeNull();
    expect(results[1].error).toContain("timed out");
  });

  it("handles agent errors gracefully", async () => {
    const provider = makeMockProvider();
    (provider.sendMessage as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("connection refused"));

    const agents = [{ repoName: "broken-repo", agentId: "a1" }];

    const results = await broadcastAsk(provider, agents, "hello");

    expect(results[0].repoName).toBe("broken-repo");
    expect(results[0].response).toBeNull();
    expect(results[0].error).toContain("connection refused");
  });
});
