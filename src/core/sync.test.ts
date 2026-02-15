import { describe, it, expect } from "vitest";
import { computeSyncPlan } from "./sync.js";
import type { PassageMap } from "./types.js";

const passages: PassageMap = {
  "src/a.ts": ["p-1", "p-2"],
  "src/b.ts": ["p-3"],
  "src/c.ts": ["p-4", "p-5", "p-6"],
};

describe("computeSyncPlan", () => {
  it("marks passages for deletion when their files changed", () => {
    const plan = computeSyncPlan(passages, ["src/a.ts", "src/b.ts"]);
    expect(plan.passagesToDelete).toEqual(["p-1", "p-2", "p-3"]);
    expect(plan.filesToReIndex).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("ignores changed files not in the passage map (new files)", () => {
    const plan = computeSyncPlan(passages, ["src/d.ts"]);
    expect(plan.passagesToDelete).toEqual([]);
    expect(plan.filesToReIndex).toEqual(["src/d.ts"]);
  });

  it("handles mix of known and new files", () => {
    const plan = computeSyncPlan(passages, ["src/a.ts", "src/new.ts"]);
    expect(plan.passagesToDelete).toEqual(["p-1", "p-2"]);
    expect(plan.filesToReIndex).toEqual(["src/a.ts", "src/new.ts"]);
  });

  it("returns empty plan for no changes", () => {
    const plan = computeSyncPlan(passages, []);
    expect(plan.passagesToDelete).toEqual([]);
    expect(plan.filesToReIndex).toEqual([]);
    expect(plan.isFullReIndex).toBe(false);
  });

  it("flags full re-index when changes exceed threshold", () => {
    const manyFiles = Array.from({ length: 501 }, (_, i) => `src/file${i}.ts`);
    const plan = computeSyncPlan(passages, manyFiles, 500);
    expect(plan.isFullReIndex).toBe(true);
  });

  it("does not flag full re-index at exactly the threshold", () => {
    const files = Array.from({ length: 500 }, (_, i) => `src/file${i}.ts`);
    const plan = computeSyncPlan(passages, files, 500);
    expect(plan.isFullReIndex).toBe(false);
  });
});
