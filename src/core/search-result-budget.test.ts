import { describe, expect, it } from "vitest";
import { budgetSearchResults, demoteTestResults } from "./search-result-budget.js";

const mk = (id: string, path: string, score: number) => ({
  id,
  text: `FILE: ${path} | FUNCTION: f\n\nbody`,
  score,
});

describe("demoteTestResults", () => {
  it("sinks test passages below implementation, preserving order within groups", () => {
    const results = [
      mk("t1", "src/core/chunker.test.ts", 0.99),
      mk("i1", "src/core/chunker.ts", 0.9),
      mk("t2", "src/shell/__test__/mock.ts", 0.8),
      mk("i2", "src/shell/sqlite-store.ts", 0.7),
    ];

    expect(demoteTestResults(results).map((r) => r.id)).toEqual([
      "i1",
      "i2",
      "t1",
      "t2",
    ]);
  });

  it("keeps tests (demotes, never drops) so test queries still surface them", () => {
    const results = [mk("t1", "a.test.ts", 0.9), mk("i1", "a.ts", 0.8)];
    expect(demoteTestResults(results)).toHaveLength(2);
  });

  it("treats headerless passages as non-test", () => {
    const results = [
      { id: "raw", text: "no header here", score: 0.9 },
      mk("t1", "a.test.ts", 0.8),
    ];
    expect(demoteTestResults(results).map((r) => r.id)).toEqual(["raw", "t1"]);
  });
});

describe("demoteTestResults composed after budgetSearchResults (the wired pipeline)", () => {
  it("never drops the most relevant result even when it is a test (limit=1)", () => {
    // The exact regression: a near-perfect test hit and a barely relevant impl
    // hit, with room for only one result. Demote-after-budget keeps the test;
    // demote-before-budget would have returned the unrelated implementation.
    const results = [
      mk("test-hit", "src/core/chunker.test.ts", 0.95),
      mk("impl-hit", "src/core/unrelated.ts", 0.5),
    ];
    const out = demoteTestResults(
      budgetSearchResults(results, { limit: 1, maxTextChars: 200, maxPerFile: 2 }),
    );
    expect(out.map((r) => r.id)).toEqual(["test-hit"]);
  });

  it("still presents implementation ahead of a test that was also selected", () => {
    const results = [
      mk("test-hit", "src/a.test.ts", 0.95),
      mk("impl-hit", "src/a.ts", 0.9),
    ];
    const out = demoteTestResults(
      budgetSearchResults(results, { limit: 2, maxTextChars: 200, maxPerFile: 2 }),
    );
    expect(out.map((r) => r.id)).toEqual(["impl-hit", "test-hit"]);
  });
});

describe("budgetSearchResults", () => {
  it("limits result count and truncates passage text", () => {
    const results = Array.from({ length: 8 }, (_, index) => ({
      id: `p-${String(index)}`,
      text: `FILE: src/file-${String(index)}.ts\n\n${"x".repeat(100)}`,
      score: 1 - index / 10,
    }));

    const budgeted = budgetSearchResults(results, {
      limit: 3,
      maxTextChars: 40,
      maxPerFile: 2,
    });

    expect(budgeted).toHaveLength(3);
    expect(budgeted.every((result) => result.text.length <= 40)).toBe(true);
    expect(budgeted.every((result) => result.truncated)).toBe(true);
  });

  it("diversifies results across files while preserving rank order", () => {
    const results = [
      { id: "a-1", text: "FILE: src/a.ts | FUNCTION: one\n\none", score: 0.9 },
      { id: "a-2", text: "FILE: src/a.ts | FUNCTION: two\n\ntwo", score: 0.8 },
      { id: "b-1", text: "FILE: src/b.ts | FUNCTION: one\n\none", score: 0.7 },
      { id: "a-3", text: "FILE: src/a.ts | FUNCTION: three\n\nthree", score: 0.6 },
    ];

    const budgeted = budgetSearchResults(results, {
      limit: 3,
      maxTextChars: 200,
      maxPerFile: 2,
    });

    expect(budgeted.map((result) => result.id)).toEqual(["a-1", "a-2", "b-1"]);
    expect(budgeted.map((result) => result.filePath)).toEqual([
      "src/a.ts",
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("counts raw continuation chunks against the same file limit", () => {
    const results = [
      { id: "a-1", text: "FILE: src/a.ts\n\none", score: 0.9 },
      { id: "a-2", text: "FILE: src/a.ts (continued)\n\ntwo", score: 0.8 },
      { id: "a-3", text: "FILE: src/a.ts\n\nthree", score: 0.7 },
      { id: "b-1", text: "FILE: src/b.ts\n\none", score: 0.6 },
    ];

    const budgeted = budgetSearchResults(results, {
      limit: 4,
      maxTextChars: 200,
      maxPerFile: 2,
    });

    expect(budgeted.map((result) => result.id)).toEqual(["a-1", "a-2", "b-1"]);
    expect(budgeted.map((result) => result.filePath)).toEqual([
      "src/a.ts",
      "src/a.ts",
      "src/b.ts",
    ]);
  });
});
