import { describe, it, expect, vi } from "vitest";
import { gatherGitEvidence, GIT_EVIDENCE_MAX_CHARS } from "./git-evidence.js";
import { OrphanedCheckpointError } from "../core/git-evidence.js";
import type { GitPort } from "../ports/git.js";
import type { AgentState } from "../core/types.js";

function makeAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    agentId: "agent-1",
    repoName: "my-app",
    passages: {},
    lastBootstrap: null,
    lastSyncCommit: null,
    lastSyncAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeGit(overrides: Partial<GitPort> = {}): GitPort {
  return {
    submoduleStatus: vi.fn().mockReturnValue(""),
    version: vi.fn().mockReturnValue("git version 2.39.0"),
    headCommit: vi.fn().mockReturnValue("head123"),
    diffFiles: vi.fn().mockReturnValue([]),
    commitExists: vi.fn().mockReturnValue(true),
    logNameStatus: vi.fn().mockReturnValue(""),
    ...overrides,
  };
}

describe("gatherGitEvidence", () => {
  it("formats a range log when the stored checkpoint still exists", () => {
    const agent = makeAgent({ lastSyncCommit: "abc123" });
    const git = makeGit({
      commitExists: vi.fn().mockReturnValue(true),
      logNameStatus: vi.fn().mockReturnValue("def4567 M\tsrc/a.ts add feature"),
    });

    const result = gatherGitEvidence(git, "/repo", agent);

    expect(git.commitExists).toHaveBeenCalledWith("/repo", "abc123");
    expect(git.logNameStatus).toHaveBeenCalledWith("/repo", { kind: "range", from: "abc123" });
    expect(result).toContain("def4567");
  });

  it("throws OrphanedCheckpointError when the stored checkpoint no longer exists", () => {
    const agent = makeAgent({ lastSyncCommit: "gone123" });
    const git = makeGit({ commitExists: vi.fn().mockReturnValue(false) });

    expect(() => gatherGitEvidence(git, "/repo", agent)).toThrow(OrphanedCheckpointError);
    expect(git.logNameStatus).not.toHaveBeenCalled();
  });

  it("falls back to a since-window for an agent with no checkpoint but a sync timestamp", () => {
    const agent = makeAgent({ lastSyncAt: "2026-01-02T00:00:00.000Z" });
    const git = makeGit();

    gatherGitEvidence(git, "/repo", agent);

    expect(git.commitExists).not.toHaveBeenCalled();
    expect(git.logNameStatus).toHaveBeenCalledWith("/repo", { kind: "since", date: "2026-01-02T00:00:00.000Z" });
  });

  it("falls back to a recent window for a brand-new agent", () => {
    const agent = makeAgent();
    const git = makeGit();

    gatherGitEvidence(git, "/repo", agent);

    expect(git.logNameStatus).toHaveBeenCalledWith("/repo", { kind: "recent", count: 20 });
  });

  it("respects a custom maxChars override", () => {
    const agent = makeAgent({ lastSyncCommit: "abc123" });
    const longEntry = `abc1234 ${"x".repeat(50)}`;
    const git = makeGit({ logNameStatus: vi.fn().mockReturnValue(longEntry) });

    const result = gatherGitEvidence(git, "/repo", agent, 10);

    expect(result.length).toBeLessThan(longEntry.length);
  });

  it("uses the default GIT_EVIDENCE_MAX_CHARS when not overridden", () => {
    expect(GIT_EVIDENCE_MAX_CHARS).toBe(4000);
  });
});
