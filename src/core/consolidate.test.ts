import { describe, it, expect } from "vitest";
import { buildConsolidationPrompt, shouldConsolidate, shouldSkipConsolidation } from "./consolidate.js";

describe("buildConsolidationPrompt", () => {
  const base = {
    architecture: "Layered app with a functional core.",
    conventions: "Use pnpm, Zod v4.",
    changedFiles: ["src/a.ts", "src/b.ts"],
    filesReIndexed: 2,
    filesRemoved: 0,
    blockCharLimit: 5000,
  };

  it("embeds the current architecture and conventions blocks", () => {
    const prompt = buildConsolidationPrompt(base);
    expect(prompt).toContain("Layered app with a functional core.");
    expect(prompt).toContain("Use pnpm, Zod v4.");
  });

  it("lists the changed files and the re-index/remove counts", () => {
    const prompt = buildConsolidationPrompt(base);
    expect(prompt).toContain("- src/a.ts");
    expect(prompt).toContain("- src/b.ts");
    expect(prompt).toContain("re-indexed 2 file(s) and removed 0 file(s)");
  });

  it("names the block char limit", () => {
    const prompt = buildConsolidationPrompt({ ...base, blockCharLimit: 3000 });
    expect(prompt).toContain("under 3000 characters");
  });

  it("instructs the model to use memory_replace and never touch persona", () => {
    const prompt = buildConsolidationPrompt(base);
    expect(prompt).toContain("Use memory_replace");
    expect(prompt).toContain("Do NOT modify the persona block");
  });

  it("caps the listed files and reports an overflow count", () => {
    const changedFiles = Array.from({ length: 60 }, (_, i) => `src/file-${String(i)}.ts`);
    const prompt = buildConsolidationPrompt({ ...base, changedFiles });
    expect(prompt).toContain("- src/file-0.ts");
    expect(prompt).toContain("- src/file-49.ts");
    expect(prompt).not.toContain("- src/file-50.ts");
    expect(prompt).toContain("...and 10 more");
  });

  it("handles an empty changed-file list (manual run) without listing files", () => {
    const prompt = buildConsolidationPrompt({ ...base, changedFiles: [], filesReIndexed: 0 });
    expect(prompt).toContain("No specific files were provided");
    expect(prompt).not.toContain("Changed files:");
  });

  it("marks empty blocks as (empty)", () => {
    const prompt = buildConsolidationPrompt({ ...base, architecture: "", conventions: "   " });
    expect(prompt).toContain("(empty)");
  });

  it("omits gitEvidence entirely when absent, producing a byte-identical prompt", () => {
    const withoutField = buildConsolidationPrompt(base);
    const withUndefined = buildConsolidationPrompt({ ...base, gitEvidence: undefined });
    expect(withUndefined).toBe(withoutField);
    expect(withoutField).not.toContain("Commit log since the last sync");
  });

  it("omits the git evidence section when gitEvidence is an empty string", () => {
    const prompt = buildConsolidationPrompt({ ...base, gitEvidence: "" });
    expect(prompt).not.toContain("Commit log since the last sync");
  });

  it("renders the git evidence section with its preamble when present", () => {
    const gitEvidence = ["```", "abc1234 Fix bug", "M\tsrc/a.ts", "```"].join("\n");
    const prompt = buildConsolidationPrompt({ ...base, gitEvidence });
    expect(prompt).toContain("Commit log since the last sync — treat as ground truth for what changed");
    expect(prompt).toContain(gitEvidence);
    // Rendered between the changed-files section and the current blocks.
    const changedIdx = prompt.indexOf("Changed files:");
    const evidenceIdx = prompt.indexOf("Commit log since the last sync");
    const blockIdx = prompt.indexOf("## Current architecture block");
    expect(changedIdx).toBeLessThan(evidenceIdx);
    expect(evidenceIdx).toBeLessThan(blockIdx);
  });
});

describe("shouldConsolidate", () => {
  it("returns false when the flag is off, regardless of file count", () => {
    const decision = shouldConsolidate(
      { filesReIndexed: 100, filesRemoved: 100 },
      false,
    );
    expect(decision).toBe(false);
  });

  it("returns false when files changed is below the threshold", () => {
    const decision = shouldConsolidate(
      { filesReIndexed: 2, filesRemoved: 1 },
      true,
    );
    expect(decision).toBe(false);
  });

  it("returns true when re-indexed + removed meets the threshold", () => {
    const decision = shouldConsolidate(
      { filesReIndexed: 3, filesRemoved: 2 },
      true,
    );
    expect(decision).toBe(true);
  });

  it("counts removed files toward the threshold", () => {
    const decision = shouldConsolidate(
      { filesReIndexed: 0, filesRemoved: 5 },
      true,
    );
    expect(decision).toBe(true);
  });
});

describe("shouldSkipConsolidation", () => {
  it("returns false when headCommit is null (no known git HEAD)", () => {
    const decision = shouldSkipConsolidation(
      { lastSyncCommit: "abc123", lastConsolidatedCommit: "abc123" },
      null,
    );
    expect(decision).toBe(false);
  });

  it("returns false when HEAD has moved past the last sync commit", () => {
    const decision = shouldSkipConsolidation(
      { lastSyncCommit: "abc123", lastConsolidatedCommit: "abc123" },
      "def456",
    );
    expect(decision).toBe(false);
  });

  it("returns false when lastSyncCommit matches HEAD but consolidation never ran at that commit", () => {
    const decision = shouldSkipConsolidation(
      { lastSyncCommit: "abc123", lastConsolidatedCommit: null },
      "abc123",
    );
    expect(decision).toBe(false);
  });

  it("returns false when lastConsolidatedCommit is a stale commit, not the current HEAD", () => {
    const decision = shouldSkipConsolidation(
      { lastSyncCommit: "abc123", lastConsolidatedCommit: "def456" },
      "abc123",
    );
    expect(decision).toBe(false);
  });

  it("returns false when lastConsolidatedCommit is omitted entirely", () => {
    const decision = shouldSkipConsolidation(
      { lastSyncCommit: "abc123" },
      "abc123",
    );
    expect(decision).toBe(false);
  });

  it("returns true when HEAD, lastSyncCommit, and lastConsolidatedCommit all agree", () => {
    const decision = shouldSkipConsolidation(
      { lastSyncCommit: "abc123", lastConsolidatedCommit: "abc123" },
      "abc123",
    );
    expect(decision).toBe(true);
  });
});
