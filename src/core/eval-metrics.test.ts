import { describe, it, expect } from "vitest";
import {
  recallAtK,
  reciprocalRank,
  aggregate,
  percentiles,
  compareReports,
  parseGoldSet,
  type BenchReport,
} from "./eval-metrics.js";

describe("recallAtK", () => {
  it("returns 1 when a gold file is in the top k", () => {
    expect(recallAtK(["a.ts", "b.ts", "c.ts"], ["a.ts"], 1)).toBe(1);
  });

  it("returns 0 when the gold file is absent", () => {
    expect(recallAtK(["a.ts", "b.ts"], ["z.ts"], 5)).toBe(0);
  });

  it("respects the k cutoff (a hit beyond k does not count)", () => {
    expect(recallAtK(["a.ts", "b.ts", "c.ts"], ["c.ts"], 2)).toBe(0);
    expect(recallAtK(["a.ts", "b.ts", "c.ts"], ["c.ts"], 3)).toBe(1);
  });

  it("averages across multiple gold files (partial recall)", () => {
    expect(recallAtK(["a.ts", "x.ts"], ["a.ts", "b.ts"], 5)).toBe(0.5);
  });

  it("returns 0 for an empty ranked list", () => {
    expect(recallAtK([], ["a.ts"], 5)).toBe(0);
  });

  it("returns 0 for empty gold (nothing to recall)", () => {
    expect(recallAtK(["a.ts"], [], 5)).toBe(0);
  });

  it("counts each gold file once even if duplicated in the ranking", () => {
    expect(recallAtK(["a.ts", "a.ts"], ["a.ts"], 5)).toBe(1);
  });
});

describe("reciprocalRank", () => {
  it("is 1 when the first gold file ranks first", () => {
    expect(reciprocalRank(["a.ts", "b.ts"], ["a.ts"])).toBe(1);
  });

  it("is 1/n when the first gold file ranks n-th", () => {
    expect(reciprocalRank(["x.ts", "y.ts", "a.ts"], ["a.ts"])).toBeCloseTo(1 / 3);
  });

  it("uses the earliest-ranked gold file when several are relevant", () => {
    expect(reciprocalRank(["x.ts", "b.ts", "a.ts"], ["a.ts", "b.ts"])).toBeCloseTo(1 / 2);
  });

  it("is 0 when no gold file appears", () => {
    expect(reciprocalRank(["x.ts", "y.ts"], ["a.ts"])).toBe(0);
  });

  it("is 0 for an empty ranked list", () => {
    expect(reciprocalRank([], ["a.ts"])).toBe(0);
  });
});

describe("aggregate", () => {
  it("computes the overall mean of per-query values", () => {
    const result = aggregate([
      { kind: "identifier", value: 1 },
      { kind: "identifier", value: 0 },
      { kind: "paraphrase", value: 0.5 },
    ]);
    expect(result.mean).toBeCloseTo(0.5);
  });

  it("breaks the mean down per kind", () => {
    const result = aggregate([
      { kind: "identifier", value: 1 },
      { kind: "identifier", value: 0 },
      { kind: "paraphrase", value: 0.5 },
    ]);
    expect(result.byKind["identifier"]).toBeCloseTo(0.5);
    expect(result.byKind["paraphrase"]).toBeCloseTo(0.5);
  });

  it("returns mean 0 and no kinds for an empty input", () => {
    const result = aggregate([]);
    expect(result.mean).toBe(0);
    expect(result.byKind).toEqual({});
  });
});

describe("percentiles", () => {
  it("computes p50/p95 over an odd sample count (nearest-rank)", () => {
    expect(percentiles([10, 20, 30], [50, 95])).toEqual([20, 30]);
  });

  it("computes p50 over an even sample count", () => {
    expect(percentiles([40, 10, 30, 20], [50])).toEqual([20]);
  });

  it("returns the single sample for every percentile", () => {
    expect(percentiles([7], [0, 50, 100])).toEqual([7, 7, 7]);
  });

  it("returns 0 for every percentile of an empty sample set", () => {
    expect(percentiles([], [50, 95])).toEqual([0, 0]);
  });
});

function baseReport(overrides: Partial<BenchReport> = {}): BenchReport {
  const metrics = {
    recallAt1: { mean: 1, byKind: {} },
    recallAt5: { mean: 1, byKind: {} },
    mrr: { mean: 1, byKind: {} },
  };
  return {
    engine: "deterministic",
    gitSha: "abc123",
    queryCount: 20,
    legs: {
      vector: structuredClone(metrics),
      lexical: structuredClone(metrics),
      fused: structuredClone(metrics),
    },
    performance: {
      indexWallMs: 100,
      chunkCount: 50,
      passageCount: 50,
      chunksPerSec: 500,
      dbSizeBytes: 1000,
      searchP50Ms: 1,
      searchP95Ms: 2,
    },
    ...overrides,
  };
}

describe("compareReports", () => {
  it("flags a metric drop beyond tolerance", () => {
    const base = baseReport();
    const current = baseReport();
    current.legs.fused.recallAt5.mean = 0.8;

    const delta = compareReports(base, current, 0.05);

    expect(delta.regressed).toBe(true);
    const drop = delta.deltas.find((d) => d.name === "fused.recallAt5");
    expect(drop?.regressed).toBe(true);
  });

  it("does not flag an improvement", () => {
    const base = baseReport();
    base.legs.fused.mrr.mean = 0.8;
    const current = baseReport();
    current.legs.fused.mrr.mean = 0.95;

    const delta = compareReports(base, current, 0.05);

    expect(delta.regressed).toBe(false);
  });

  it("does not flag a drop within tolerance", () => {
    const base = baseReport();
    const current = baseReport();
    current.legs.vector.recallAt1.mean = 0.97;

    const delta = compareReports(base, current, 0.05);

    expect(delta.regressed).toBe(false);
  });

  it("ignores timing/performance fields when comparing", () => {
    const base = baseReport();
    const current = baseReport();
    current.performance.searchP95Ms = 9999;
    current.performance.indexWallMs = 9999;

    const delta = compareReports(base, current, 0.05);

    expect(delta.regressed).toBe(false);
  });
});

describe("parseGoldSet", () => {
  const validQuery = {
    id: "ident-1",
    kind: "identifier",
    query: "where is fooBar defined?",
    expect_files: ["src/foo.ts"],
    expect_rank: 1,
  };

  it("parses a valid gold set", () => {
    const parsed = parseGoldSet({ queries: [validQuery] });
    expect(parsed.queries).toHaveLength(1);
    expect(parsed.queries[0]?.kind).toBe("identifier");
  });

  it("rejects an unknown kind", () => {
    expect(() => parseGoldSet({ queries: [{ ...validQuery, kind: "bogus" }] })).toThrow();
  });

  it("rejects empty expect_files", () => {
    expect(() => parseGoldSet({ queries: [{ ...validQuery, expect_files: [] }] })).toThrow();
  });

  it("rejects duplicate ids", () => {
    expect(() =>
      parseGoldSet({ queries: [validQuery, { ...validQuery }] }),
    ).toThrow(/duplicate/i);
  });

  it("accepts a query without the optional expect_rank", () => {
    const noRank = {
      id: "no-rank",
      kind: "paraphrase",
      query: "how does settlement work",
      expect_files: ["docs/notes.md"],
    };
    const parsed = parseGoldSet({ queries: [noRank] });
    expect(parsed.queries[0]?.expect_rank).toBeUndefined();
  });
});
