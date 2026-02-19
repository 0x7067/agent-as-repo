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
  it("uploads new passages before deleting old ones (copy-on-write)", async () => {
    const provider = makeMockProvider();
    const callOrder: string[] = [];
    provider.storePassage = vi.fn().mockImplementation(async () => {
      callOrder.push("store");
      return "new-passage";
    });
    provider.deletePassage = vi.fn().mockImplementation(async () => {
      callOrder.push("delete");
    });

    await syncRepo({
      provider,
      agent: testAgent,
      changedFiles: ["src/a.ts"],
      collectFile: async (path) => ({ path, content: "new content", sizeKb: 1 }),
      headCommit: "def456",
    });

    // All stores happen before all deletes
    const firstDelete = callOrder.indexOf("delete");
    const lastStore = callOrder.lastIndexOf("store");
    expect(lastStore).toBeLessThan(firstDelete);
  });

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
    expect(result.failedFiles).toEqual([]);
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

  it("uses custom chunkingStrategy when provided", async () => {
    const customStrategy = vi.fn().mockReturnValue([
      { text: "custom chunk", sourcePath: "src/a.ts" },
    ]);
    const provider = makeMockProvider();
    await syncRepo({
      provider,
      agent: testAgent,
      changedFiles: ["src/a.ts"],
      collectFile: async (path) => ({ path, content: "content", sizeKb: 1 }),
      headCommit: "def456",
      chunkingStrategy: customStrategy,
    });

    expect(customStrategy).toHaveBeenCalledWith({ path: "src/a.ts", content: "content", sizeKb: 1 });
    expect(provider.storePassage).toHaveBeenCalledWith("agent-abc", "custom chunk");
  });

  it("defaults to rawTextStrategy when chunkingStrategy is omitted", async () => {
    const provider = makeMockProvider();
    const result = await syncRepo({
      provider,
      agent: testAgent,
      changedFiles: ["src/a.ts"],
      collectFile: async (path) => ({ path, content: "const x = 1;", sizeKb: 0.01 }),
      headCommit: "def456",
    });

    // rawTextStrategy produces a chunk with FILE: prefix
    expect(provider.storePassage).toHaveBeenCalledWith(
      "agent-abc",
      expect.stringContaining("FILE: src/a.ts"),
    );
    expect(result.passages["src/a.ts"]).toBeDefined();
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

  it("skips oversized files when maxFileSizeKb is set", async () => {
    const provider = makeMockProvider();
    const result = await syncRepo({
      provider,
      agent: testAgent,
      changedFiles: ["src/a.ts"],
      collectFile: async (path) => ({ path, content: "x".repeat(200_000), sizeKb: 200 }),
      headCommit: "def456",
      maxFileSizeKb: 50,
    });

    expect(provider.deletePassage).toHaveBeenCalledTimes(2);
    expect(provider.storePassage).not.toHaveBeenCalled();
    expect(result.passages["src/a.ts"]).toBeUndefined();
    expect(result.filesReIndexed).toBe(0);
  });

  describe("per-file error isolation", () => {
    it("continues syncing other files when one file upload fails", async () => {
      const provider = makeMockProvider();
      let callCount = 0;
      provider.storePassage = vi.fn().mockImplementation(async (_agentId: string, text: string) => {
        callCount++;
        if (text.includes("src/a.ts")) throw new Error("upload failed");
        return `passage-${callCount}`;
      });

      const errors: Array<{ file: string; error: Error }> = [];
      const result = await syncRepo({
        provider,
        agent: testAgent,
        changedFiles: ["src/a.ts", "src/b.ts"],
        collectFile: async (path) => ({ path, content: `content of ${path}`, sizeKb: 1 }),
        headCommit: "def456",
        onFileError: (file, error) => errors.push({ file, error }),
      });

      // a.ts failed — old passages kept
      expect(result.failedFiles).toEqual(["src/a.ts"]);
      expect(result.passages["src/a.ts"]).toEqual(["p-1", "p-2"]);
      // b.ts succeeded — new passages stored
      expect(result.passages["src/b.ts"]).toBeDefined();
      expect(result.passages["src/b.ts"]).not.toEqual(["p-3"]);
      expect(result.filesReIndexed).toBe(1);
      // Error callback fired
      expect(errors).toHaveLength(1);
      expect(errors[0].file).toBe("src/a.ts");
    });

    it("old passages for failed file are NOT deleted", async () => {
      const provider = makeMockProvider();
      provider.storePassage = vi.fn().mockRejectedValue(new Error("all uploads fail"));

      const result = await syncRepo({
        provider,
        agent: testAgent,
        changedFiles: ["src/a.ts"],
        collectFile: async (path) => ({ path, content: "content", sizeKb: 1 }),
        headCommit: "def456",
      });

      // Old passages preserved — deletePassage never called for p-1, p-2
      expect(provider.deletePassage).not.toHaveBeenCalled();
      expect(result.passages["src/a.ts"]).toEqual(["p-1", "p-2"]);
      expect(result.failedFiles).toEqual(["src/a.ts"]);
    });

    it("delete failures in cleanup phase are silently ignored", async () => {
      const provider = makeMockProvider();
      provider.deletePassage = vi.fn().mockRejectedValue(new Error("delete failed"));

      const result = await syncRepo({
        provider,
        agent: testAgent,
        changedFiles: ["src/a.ts"],
        collectFile: async (path) => ({ path, content: "new content", sizeKb: 1 }),
        headCommit: "def456",
      });

      // Sync still succeeds despite delete failures
      expect(result.passages["src/a.ts"]).toBeDefined();
      expect(result.failedFiles).toEqual([]);
    });
  });
});
