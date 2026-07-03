import { describe, it, expect } from "vitest";
import { buildConsolidationPrompt, shouldConsolidate } from "./consolidate.js";

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
});

describe("shouldConsolidate", () => {
  it("returns false when the flag is off, regardless of file count", () => {
    const decision = shouldConsolidate(
      { filesReIndexed: 100, filesRemoved: 100 },
      { consolidateOnSync: false, consolidateMinFilesChanged: 5 },
    );
    expect(decision).toBe(false);
  });

  it("returns false when files changed is below the threshold", () => {
    const decision = shouldConsolidate(
      { filesReIndexed: 2, filesRemoved: 1 },
      { consolidateOnSync: true, consolidateMinFilesChanged: 5 },
    );
    expect(decision).toBe(false);
  });

  it("returns true when re-indexed + removed meets the threshold", () => {
    const decision = shouldConsolidate(
      { filesReIndexed: 3, filesRemoved: 2 },
      { consolidateOnSync: true, consolidateMinFilesChanged: 5 },
    );
    expect(decision).toBe(true);
  });

  it("counts removed files toward the threshold", () => {
    const decision = shouldConsolidate(
      { filesReIndexed: 0, filesRemoved: 5 },
      { consolidateOnSync: true, consolidateMinFilesChanged: 5 },
    );
    expect(decision).toBe(true);
  });
});
