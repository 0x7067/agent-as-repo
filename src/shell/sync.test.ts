import { describe, it, expect, vi } from "vitest";
import { syncRepo } from "./sync.js";
import type { AgentState } from "../core/types.js";
import { makeMockProvider as makeBase } from "./__test__/mock-provider.js";

function makeMockProvider() {
  let passageCounter = 0;
  return makeBase({
    storePassage: vi.fn().mockImplementation(async () => `passage-${++passageCounter}`),
  });
}

const testAgent: AgentState = {
  agentId: "agent-abc",
  repoName: "my-app",
  passages: {
    "src/a.ts": ["p-1", "p-2"],
    "src/b.ts": ["p-3"],
  },
  lastBootstrap: "2026-01-01T00:00:00.000Z",
  lastSyncCommit: "abc123",
  lastSyncAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("syncRepo", () => {
  it("deletes old passages and stores new ones for changed files", async () => {
    const provider = makeMockProvider();
    const result = await syncRepo({
      provider,
      agent: testAgent,
      changedFiles: ["src/a.ts"],
      collectFile: async (path) => ({ path, content: "new content", sizeKb: 1 }),
      headCommit: "def456",
    });

    expect(provider.deletePassage).toHaveBeenCalledTimes(2);
    expect(provider.deletePassage).toHaveBeenCalledWith("agent-abc", "p-1");
    expect(provider.deletePassage).toHaveBeenCalledWith("agent-abc", "p-2");
    expect(provider.storePassage).toHaveBeenCalled();
    expect(result.lastSyncCommit).toBe("def456");
    expect(result.passages["src/a.ts"]).toBeDefined();
    // b.ts passages unchanged
    expect(result.passages["src/b.ts"]).toEqual(["p-3"]);
  });

  it("handles deleted files (collectFile returns null)", async () => {
    const provider = makeMockProvider();
    const result = await syncRepo({
      provider,
      agent: testAgent,
      changedFiles: ["src/a.ts"],
      collectFile: async () => null,
      headCommit: "def456",
    });

    // Old passages deleted
    expect(provider.deletePassage).toHaveBeenCalledTimes(2);
    // No new passages stored
    expect(provider.storePassage).not.toHaveBeenCalled();
    // File removed from passage map
    expect(result.passages["src/a.ts"]).toBeUndefined();
  });

  it("handles new files (not in old passage map)", async () => {
    const provider = makeMockProvider();
    const result = await syncRepo({
      provider,
      agent: testAgent,
      changedFiles: ["src/new.ts"],
      collectFile: async (path) => ({ path, content: "brand new", sizeKb: 1 }),
      headCommit: "def456",
    });

    expect(provider.deletePassage).not.toHaveBeenCalled();
    expect(provider.storePassage).toHaveBeenCalled();
    expect(result.passages["src/new.ts"]).toBeDefined();
  });

  it("returns unchanged state for empty changed files", async () => {
    const provider = makeMockProvider();
    const result = await syncRepo({
      provider,
      agent: testAgent,
      changedFiles: [],
      collectFile: async () => null,
      headCommit: "def456",
    });

    expect(provider.deletePassage).not.toHaveBeenCalled();
    expect(provider.storePassage).not.toHaveBeenCalled();
    expect(result.passages).toEqual(testAgent.passages);
    expect(result.lastSyncCommit).toBe("def456");
  });
});
