import { describe, it, expect } from "vitest";
import { rrfFuse, toFtsMatchQuery } from "./hybrid-rank.js";

describe("rrfFuse", () => {
  it("passes a single list through in order with 1/(k+rank) scores", () => {
    const fused = rrfFuse([["a", "b", "c"]]);

    expect(fused).toEqual([
      { id: "a", score: 1 / 61 },
      { id: "b", score: 1 / 62 },
      { id: "c", score: 1 / 63 },
    ]);
  });

  it("ranks an id present in both lists above same-rank single-list ids", () => {
    const fused = rrfFuse([
      ["both", "vector-only"],
      ["lexical-only", "both"],
    ]);

    expect(fused[0]).toEqual({ id: "both", score: 1 / 61 + 1 / 62 });
    const ids = fused.map((entry) => entry.id);
    expect(ids.indexOf("both")).toBeLessThan(ids.indexOf("vector-only"));
    expect(ids.indexOf("both")).toBeLessThan(ids.indexOf("lexical-only"));
  });

  it("breaks score ties deterministically by first appearance across the lists", () => {
    const lists = [
      ["a", "b"],
      ["c", "d"],
    ];

    const first = rrfFuse(lists);
    const second = rrfFuse(lists);

    // "a" and "c" tie at 1/61, "b" and "d" tie at 1/62: earlier list wins.
    expect(first.map((entry) => entry.id)).toEqual(["a", "c", "b", "d"]);
    expect(second).toEqual(first);
  });

  it("respects a custom k constant", () => {
    const fused = rrfFuse([["a"]], 1);

    expect(fused).toEqual([{ id: "a", score: 1 / 2 }]);
  });

  it("returns [] for empty input lists", () => {
    expect(rrfFuse([])).toEqual([]);
    expect(rrfFuse([[], []])).toEqual([]);
  });

  it("with vector weight 2 and k=10, a vector rank-1 id outranks a weak dual-leg id that would have won at unweighted k=60", () => {
    // Reproduces the production bug and its fix (see FUSED_RRF_K doc comment):
    // unweighted k=60 lets a mediocre dual-leg co-occurrence (rank 20 in both
    // legs: 1/80 + 1/80 = 1/40) beat a clean single-leg vector rank-1
    // (1/61) — 1/40 > 1/61, so the semantic top hit gets buried.
    const filler0 = Array.from({ length: 18 }, (_, i) => `v-filler-${String(i)}`);
    const filler1 = Array.from({ length: 19 }, (_, i) => `l-filler-${String(i)}`);
    const vectorList = ["vec-top", ...filler0, "dual-weak"]; // dual-weak at rank 20
    const lexicalList = [...filler1, "dual-weak"]; // dual-weak at rank 20

    // Unweighted, k=60: dual-weak (1/80 + 1/80 = 1/40 = 0.025) beats
    // vec-top (1/61 ≈ 0.0164) — the bug.
    const buggy = rrfFuse([vectorList, lexicalList], 60);
    const buggyIds = buggy.map((entry) => entry.id);
    expect(buggyIds.indexOf("dual-weak")).toBeLessThan(buggyIds.indexOf("vec-top"));

    // Weighted, k=10, weights [2, 1]: vec-top (2/11 ≈ 0.1818) beats
    // dual-weak (2/30 + 1/30 = 3/30 = 0.1) — the fix.
    const fixed = rrfFuse([vectorList, lexicalList], 10, [2, 1]);
    expect(fixed[0]).toEqual({ id: "vec-top", score: 2 / 11 });
    const fixedDualWeak = fixed.find((entry) => entry.id === "dual-weak");
    expect(fixedDualWeak).toEqual({ id: "dual-weak", score: 3 / 30 });
    const fixedIds = fixed.map((entry) => entry.id);
    expect(fixedIds.indexOf("vec-top")).toBeLessThan(fixedIds.indexOf("dual-weak"));
  });

  it("omitting weights is identical to passing all-1 weights (backward compat)", () => {
    const lists = [
      ["a", "b", "c"],
      ["c", "a"],
    ];

    const withoutWeights = rrfFuse(lists, 60);
    const withUnitWeights = rrfFuse(lists, 60, [1, 1]);

    expect(withoutWeights).toEqual(withUnitWeights);
  });

  it("throws a clear error when weights length does not match lists length", () => {
    expect(() => rrfFuse([["a"], ["b"]], 60, [1])).toThrow(/weights/i);
  });
});

describe("toFtsMatchQuery", () => {
  it("quotes plain words and joins them with OR", () => {
    expect(toFtsMatchQuery("where is reconcile")).toBe('"where" OR "is" OR "reconcile"');
  });

  it("keeps identifiers whole, including snake_case underscores", () => {
    expect(toFtsMatchQuery("handleAuth snake_case")).toBe('"handleAuth" OR "snake_case"');
  });

  it("neutralizes FTS5 operator syntax into quoted bare terms", () => {
    expect(toFtsMatchQuery("NEAR(a b)")).toBe('"NEAR" OR "a" OR "b"');
    expect(toFtsMatchQuery('"quoted"')).toBe('"quoted"');
    expect(toFtsMatchQuery("foo*")).toBe('"foo"');
    expect(toFtsMatchQuery("-bar")).toBe('"bar"');
    expect(toFtsMatchQuery("(paren)")).toBe('"paren"');
  });

  it("returns undefined when no terms survive", () => {
    expect(toFtsMatchQuery("!!! ??? ---")).toBeUndefined();
    expect(toFtsMatchQuery("")).toBeUndefined();
    expect(toFtsMatchQuery("   ")).toBeUndefined();
  });
});
