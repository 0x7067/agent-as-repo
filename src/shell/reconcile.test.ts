import { describe, expect, it, vi } from "vitest";
import { fixReconcileDrift, reconcileAgent } from "./reconcile.js";
import type { AgentProvider, Passage } from "./provider.js";
import type { AgentState } from "../core/types.js";

function makeAgent(passages: AgentState["passages"]): AgentState {
  return {
    agentId: "agent-1",
    repoName: "my-repo",
    passages,
    lastBootstrap: null,
    lastSyncCommit: null,
    lastSyncAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeProvider(serverPassages: Passage[]): AgentProvider {
  return {
    listPassages: vi.fn().mockResolvedValue(serverPassages),
    deletePassage: vi.fn().mockResolvedValue(),
    createAgent: vi.fn(),
    deleteAgent: vi.fn(),
    enableSleeptime: vi.fn(),
    storePassage: vi.fn(),
    getBlock: vi.fn(),
    sendMessage: vi.fn(),
  };
}

describe("reconcileAgent", () => {
  it("reports in-sync when local map matches server", async () => {
    const agent = makeAgent({ "a.ts": ["p1", "p2"] });
    const provider = makeProvider([
      { id: "p1", text: "..." },
      { id: "p2", text: "..." },
    ]);
    const result = await reconcileAgent(provider, agent);
    expect(result.inSync).toBe(true);
    expect(result.localPassageCount).toBe(2);
    expect(result.serverPassageCount).toBe(2);
    expect(result.orphanPassageIds).toEqual([]);
    expect(result.missingPassageIds).toEqual([]);
  });

  it("reports orphan passages (on server, not in local map)", async () => {
    const agent = makeAgent({ "a.ts": ["p1"] });
    const provider = makeProvider([
      { id: "p1", text: "..." },
      { id: "p2", text: "orphan" },
    ]);
    const result = await reconcileAgent(provider, agent);
    expect(result.inSync).toBe(false);
    expect(result.orphanPassageIds).toEqual(["p2"]);
    expect(result.missingPassageIds).toEqual([]);
  });

  it("reports missing passages (in local map, not on server)", async () => {
    const agent = makeAgent({ "a.ts": ["p1", "p2"] });
    const provider = makeProvider([{ id: "p1", text: "..." }]);
    const result = await reconcileAgent(provider, agent);
    expect(result.inSync).toBe(false);
    expect(result.missingPassageIds).toEqual(["p2"]);
    expect(result.orphanPassageIds).toEqual([]);
  });
});

describe("fixReconcileDrift", () => {
  it("deletes orphan passages and removes missing IDs from map", async () => {
    const agent = makeAgent({ "a.ts": ["p1", "p2"] });
    const provider = makeProvider([]);
    (provider.deletePassage as ReturnType<typeof vi.fn>).mockResolvedValue();

    const updatedMap = await fixReconcileDrift(provider, agent, {
      orphanPassageIds: ["p-orphan"],
      missingPassageIds: ["p2"],
    });

    expect(provider.deletePassage).toHaveBeenCalledWith("agent-1", "p-orphan");
    expect(updatedMap["a.ts"]).toEqual(["p1"]);
  });

  it("silently ignores orphan deletion failures", async () => {
    const agent = makeAgent({});
    const provider = makeProvider([]);
    (provider.deletePassage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("gone"));

    await expect(
      fixReconcileDrift(provider, agent, {
        orphanPassageIds: ["p-gone"],
        missingPassageIds: [],
      }),
    ).resolves.not.toThrow();
  });
});
