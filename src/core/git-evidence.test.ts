import { describe, it, expect } from "vitest";
import { selectEvidenceSource, formatGitEvidence } from "./git-evidence.js";
import type { AgentState } from "./types.js";

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

describe("selectEvidenceSource", () => {
  it("returns a range source when lastSyncCommit is set and the commit still exists", () => {
    const agent = makeAgent({ lastSyncCommit: "abc123" });
    expect(selectEvidenceSource(agent, true)).toEqual({ kind: "range", from: "abc123" });
  });

  it("falls back to since when lastSyncCommit is set but the commit no longer exists", () => {
    const agent = makeAgent({ lastSyncCommit: "abc123", lastSyncAt: "2026-01-02T00:00:00.000Z" });
    expect(selectEvidenceSource(agent, false)).toEqual({ kind: "since", date: "2026-01-02T00:00:00.000Z" });
  });

  it("falls back to since when lastSyncCommit is not set", () => {
    const agent = makeAgent({ lastSyncAt: "2026-01-02T00:00:00.000Z" });
    expect(selectEvidenceSource(agent, false)).toEqual({ kind: "since", date: "2026-01-02T00:00:00.000Z" });
  });

  it("falls back to recent when neither lastSyncCommit nor lastSyncAt is usable", () => {
    const agent = makeAgent({ lastSyncCommit: "abc123", lastSyncAt: null });
    expect(selectEvidenceSource(agent, false)).toEqual({ kind: "recent", count: 20 });
  });

  it("falls back to recent when nothing is set at all", () => {
    const agent = makeAgent();
    expect(selectEvidenceSource(agent, false)).toEqual({ kind: "recent", count: 20 });
  });
});

describe("formatGitEvidence", () => {
  it("returns empty string for an empty log", () => {
    expect(formatGitEvidence("", 4000)).toBe("");
    expect(formatGitEvidence("   \n  ", 4000)).toBe("");
  });

  it("wraps a short log in a fenced section unchanged", () => {
    const log = "abc1234 Fix bug\nM\tsrc/a.ts";
    const result = formatGitEvidence(log, 4000);
    expect(result).toBe(["```", log, "```"].join("\n"));
  });

  it("keeps the newest commits and truncates the oldest when over the cap", () => {
    // Real `git log` output is newest-first.
    const newestCommit = "3333333 newest commit";
    const commits = [
      newestCommit,
      "2222222 middle commit",
      "1111111 oldest commit",
    ];
    const log = commits.join("\n");
    // Cap tight enough to keep only the newest commit.
    const maxChars = newestCommit.length;
    const result = formatGitEvidence(log, maxChars);

    expect(result).toContain("3333333 newest commit");
    expect(result).not.toContain("1111111 oldest commit");
    expect(result).not.toContain("2222222 middle commit");
    expect(result).toContain("…and 2 earlier commits omitted");
  });

  it("never leaves a gap: keeps a contiguous newest-first prefix even when an older commit would fit", () => {
    // The middle commit is large; the small oldest commit would fit in the
    // leftover budget, but keeping it would create a hole in the history.
    const newest = "3333333 newest commit\nM\ta.ts";
    const middle = `2222222 middle commit\n${"M\tvery/long/path/file.ts\n".repeat(5).trim()}`;
    const oldest = "1111111 old";
    const log = [newest, middle, oldest].join("\n");
    const result = formatGitEvidence(log, newest.length + 1 + oldest.length);

    expect(result).toContain("3333333 newest commit");
    expect(result).not.toContain("2222222 middle commit");
    expect(result).not.toContain("1111111 old");
    expect(result).toContain("…and 2 earlier commits omitted");
  });

  it("appends nothing extra when the log fits exactly", () => {
    const log = "abc1234 Only commit";
    const result = formatGitEvidence(log, log.length);
    expect(result).not.toContain("omitted");
  });
});
