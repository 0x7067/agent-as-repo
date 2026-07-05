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
