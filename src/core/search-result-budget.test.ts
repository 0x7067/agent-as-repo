import { describe, expect, it } from "vitest";
import { budgetSearchResults } from "./search-result-budget.js";

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
});
