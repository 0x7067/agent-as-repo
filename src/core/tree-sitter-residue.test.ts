import { describe, expect, it } from "vitest";
import { findGaps, hasAlphanumeric, mergeRanges, residueChunks } from "./tree-sitter-residue.js";

describe("mergeRanges", () => {
  it("merges overlapping ranges", () => {
    expect(mergeRanges([{ startIndex: 0, endIndex: 10 }, { startIndex: 5, endIndex: 15 }])).toEqual([
      { startIndex: 0, endIndex: 15 },
    ]);
  });

  it("merges a nested range (e.g. a METHOD span inside its CLASS span) into the enclosing range", () => {
    expect(mergeRanges([{ startIndex: 0, endIndex: 20 }, { startIndex: 5, endIndex: 10 }])).toEqual([
      { startIndex: 0, endIndex: 20 },
    ]);
  });

  it("keeps disjoint ranges separate, sorted by start", () => {
    expect(mergeRanges([{ startIndex: 20, endIndex: 30 }, { startIndex: 0, endIndex: 10 }])).toEqual([
      { startIndex: 0, endIndex: 10 },
      { startIndex: 20, endIndex: 30 },
    ]);
  });

  it("merges touching ranges (end === start)", () => {
    expect(mergeRanges([{ startIndex: 0, endIndex: 10 }, { startIndex: 10, endIndex: 20 }])).toEqual([
      { startIndex: 0, endIndex: 20 },
    ]);
  });

  it("returns an empty array for no ranges", () => {
    expect(mergeRanges([])).toEqual([]);
  });
});

describe("findGaps", () => {
  it("finds a gap before, between, and after covered ranges", () => {
    const covered = mergeRanges([{ startIndex: 10, endIndex: 20 }, { startIndex: 30, endIndex: 40 }]);
    expect(findGaps(50, covered)).toEqual([
      { startIndex: 0, endIndex: 10 },
      { startIndex: 20, endIndex: 30 },
      { startIndex: 40, endIndex: 50 },
    ]);
  });

  it("returns no gaps when a single range covers the whole content", () => {
    expect(findGaps(10, [{ startIndex: 0, endIndex: 10 }])).toEqual([]);
  });

  it("treats an empty covered list as one big gap spanning the whole content", () => {
    expect(findGaps(10, [])).toEqual([{ startIndex: 0, endIndex: 10 }]);
  });
});

describe("hasAlphanumeric", () => {
  it("is false for punctuation/whitespace-only fragments like a lone brace", () => {
    expect(hasAlphanumeric("}")).toBe(false);
    expect(hasAlphanumeric("  \n\n};\n")).toBe(false);
  });

  it("is true when any letter or digit is present", () => {
    expect(hasAlphanumeric("use std::foo;")).toBe(true);
    expect(hasAlphanumeric("x")).toBe(true);
    expect(hasAlphanumeric("1")).toBe(true);
  });
});

describe("residueChunks", () => {
  it("emits a plain FILE: header chunk for the uncovered gap between two spans", () => {
    const content = "top level statement;\n\nfunction foo() {}\n";
    const fnStart = content.indexOf("function");
    const ranges = [{ startIndex: fnStart, endIndex: content.length }];
    const chunks = residueChunks("src/x.js", content, ranges, 2000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text.startsWith("FILE: src/x.js")).toBe(true);
    expect(chunks[0]?.text).toContain("top level statement;");
  });

  it("skips a gap containing no alphanumeric characters (e.g. a lone brace)", () => {
    const content = "class Foo {\n  bar() {}\n}\n";
    const ranges = [{ startIndex: 0, endIndex: content.indexOf("}\n") + 1 }];
    const chunks = residueChunks("src/x.js", content, ranges, 2000);
    // Remaining gap is just "\n" — no alphanumeric content, no chunk emitted.
    expect(chunks).toEqual([]);
  });

  it("returns no chunks when a single range covers the entire content", () => {
    const content = "function foo() {}\n";
    const chunks = residueChunks("src/x.js", content, [{ startIndex: 0, endIndex: content.length }], 2000);
    expect(chunks).toEqual([]);
  });

  it("chunks the whole content as residue when there are no covering ranges at all", () => {
    const content = "just some raw text with letters\n";
    const chunks = residueChunks("src/x.txt", content, [], 2000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain("just some raw text with letters");
  });
});
