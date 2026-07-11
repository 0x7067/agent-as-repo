import { z } from "zod/v4";

/**
 * Pure retrieval-quality metrics for the benchmark tier. No I/O, no clocks:
 * timing samples are passed in as plain numbers (measured shell-side), never
 * read here. Rankings are lists of source file paths; gold labels are the
 * expected source paths for a query.
 */

/** Mean of per-query values, plus the mean broken down per query kind. */
export interface EvalAggregate {
  mean: number;
  byKind: Record<string, number>;
}

/**
 * Recall@k: of the distinct gold files, the fraction that appear in the first
 * `k` ranked results. 0 when there is nothing to recall (empty gold) so an
 * unanswerable query never inflates the mean.
 */
export function recallAtK(
  rankedFiles: readonly string[],
  gold: readonly string[],
  k: number,
): number {
  const goldSet = new Set(gold);
  if (goldSet.size === 0) return 0;
  const topK = new Set(rankedFiles.slice(0, Math.max(0, k)));
  let hits = 0;
  for (const file of goldSet) {
    if (topK.has(file)) hits++;
  }
  return hits / goldSet.size;
}

/**
 * Reciprocal rank: 1 / (1-based rank of the earliest-ranked gold file), or 0
 * when no gold file appears in the ranking.
 */
export function reciprocalRank(
  rankedFiles: readonly string[],
  gold: readonly string[],
): number {
  const goldSet = new Set(gold);
  if (goldSet.size === 0) return 0;
  for (const [index, file] of rankedFiles.entries()) {
    if (goldSet.has(file)) return 1 / (index + 1);
  }
  return 0;
}

/** Mean of `value`, overall and grouped by `kind`. Empty input → mean 0, no kinds. */
export function aggregate(
  perQuery: ReadonlyArray<{ kind: string; value: number }>,
): EvalAggregate {
  if (perQuery.length === 0) return { mean: 0, byKind: {} };

  let total = 0;
  const sumByKind = new Map<string, { sum: number; count: number }>();
  for (const { kind, value } of perQuery) {
    total += value;
    const bucket = sumByKind.get(kind) ?? { sum: 0, count: 0 };
    bucket.sum += value;
    bucket.count += 1;
    sumByKind.set(kind, bucket);
  }

  const byKind: Record<string, number> = {};
  for (const [kind, { sum, count }] of sumByKind) {
    byKind[kind] = sum / count;
  }
  return { mean: total / perQuery.length, byKind };
}

/**
 * Percentiles over duration samples via the nearest-rank method. Pure over the
 * supplied numbers — no clock is read here. Empty samples → 0 for every p.
 * `ps` are in [0, 100]; the returned array is parallel to `ps`.
 */
export function percentiles(
  samples: readonly number[],
  ps: readonly number[],
): number[] {
  if (samples.length === 0) return ps.map(() => 0);
  // eslint-disable-next-line unicorn/no-array-sort -- Array#toSorted needs the ES2023 lib; this project targets ES2022
  const sorted = [...samples].sort((a, b) => a - b);
  return ps.map((p) => {
    const clamped = Math.min(100, Math.max(0, p));
    const rank = Math.ceil((clamped / 100) * sorted.length);
    const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
    return sorted.at(index) ?? 0;
  });
}

// ---------------------------------------------------------------------------
// Benchmark report shape + comparison
// ---------------------------------------------------------------------------

/** The three retrieval-quality metrics scored for a single search leg. */
export interface LegMetrics {
  recallAt1: EvalAggregate;
  recallAt5: EvalAggregate;
  mrr: EvalAggregate;
}

/** Report-only performance numbers (never gated; excluded from comparison). */
export interface BenchPerformance {
  indexWallMs: number;
  chunkCount: number;
  passageCount: number;
  chunksPerSec: number;
  dbSizeBytes: number;
  searchP50Ms: number;
  searchP95Ms: number;
}

/** A full benchmark run: per-leg quality metrics plus performance timings. */
export interface BenchReport {
  engine: string;
  gitSha: string;
  queryCount: number;
  legs: {
    vector: LegMetrics;
    lexical: LegMetrics;
    fused: LegMetrics;
  };
  performance: BenchPerformance;
}

/** One metric's before/after with a regression flag. */
export interface MetricDelta {
  name: string;
  base: number;
  current: number;
  delta: number;
  regressed: boolean;
}

/** Result of comparing two reports: every quality metric's delta + overall flag. */
export interface ReportDelta {
  deltas: MetricDelta[];
  regressed: boolean;
}

const LEG_NAMES = ["vector", "lexical", "fused"] as const;
const METRIC_NAMES = ["recallAt1", "recallAt5", "mrr"] as const;

/**
 * Diff two reports' quality metrics; a metric regresses when it drops more than
 * `tolerance` below the base. Performance/timing fields are deliberately not
 * compared — CI hardware variance makes latency gates flaky.
 */
export function compareReports(
  base: BenchReport,
  current: BenchReport,
  tolerance: number,
): ReportDelta {
  const deltas: MetricDelta[] = [];
  for (const leg of LEG_NAMES) {
    for (const metric of METRIC_NAMES) {
      const baseValue = base.legs[leg][metric].mean;
      const currentValue = current.legs[leg][metric].mean;
      const delta = currentValue - baseValue;
      deltas.push({
        name: `${leg}.${metric}`,
        base: baseValue,
        current: currentValue,
        delta,
        regressed: delta < -tolerance,
      });
    }
  }
  return { deltas, regressed: deltas.some((d) => d.regressed) };
}

// ---------------------------------------------------------------------------
// Gold set schema (validated with zod v4)
// ---------------------------------------------------------------------------

/** Retrieval-target categories a gold query can probe. */
export const GOLD_KINDS = [
  "identifier",
  "paraphrase",
  "error-string",
  "config-key",
  "no-term",
] as const;

export type GoldKind = (typeof GOLD_KINDS)[number];

const goldQuerySchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(GOLD_KINDS),
  query: z.string().min(1),
  expect_files: z.array(z.string().min(1)).min(1),
  expect_rank: z.number().int().positive().optional(),
});

export type GoldQuery = z.infer<typeof goldQuerySchema>;

const goldSetSchema = z.strictObject({
  queries: z.array(goldQuerySchema).min(1),
}).superRefine((value, ctx) => {
  const seen = new Set<string>();
  for (const [index, query] of value.queries.entries()) {
    if (seen.has(query.id)) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate query id "${query.id}"`,
        path: ["queries", index, "id"],
      });
    }
    seen.add(query.id);
  }
});

export type GoldSet = z.infer<typeof goldSetSchema>;

/** Parse + validate a gold file: unique ids, known kinds, non-empty expect_files. */
export function parseGoldSet(raw: unknown): GoldSet {
  return goldSetSchema.parse(raw);
}
