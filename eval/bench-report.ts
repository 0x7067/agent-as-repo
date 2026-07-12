/** Benchmark gates, markdown summary, and stdout rendering. */
import path from "node:path";

import type { BenchReport, ReportDelta } from "../src/core/eval-metrics.js";
import { PROJECT_ROOT, type Engine, type LegName } from "./bench-pipeline.js";

const MRR_SLACK = 0.05;

// Stub-tier smoke floors: paraphrase and no-term fused recall went completely
// ungated until 2026-07 (the weighted-RRF fix in 64345cc), so a fusion
// regression to 0.0 in either bucket would have passed CI silently. These
// floors are just enough for the deterministic hash-bag-of-words stub
// embedder to express and are not tuned quality targets — real-embedding
// expectations live in eval/baselines/{transformersjs,http}.json and
// docs/testing/.
const PARAPHRASE_FUSED_R1_FLOOR = 0.2; // current: exactly 3/15
const NO_TERM_FUSED_R5_FLOOR = 0.2; // current: 5/22 ≈ 0.227; R@1 granularity (1/22) is too coarse to floor

export interface GateResult {
  passed: boolean;
  lines: string[];
}

/** A gate over one kind's byKind value: skip when the kind has no queries in this run. */
function kindFloorLine(
  label: string,
  byKind: Record<string, number>,
  kind: string,
  floor: number,
): { ok: boolean; line: string } {
  if (!(kind in byKind)) {
    return { ok: true, line: `PASS  ${label} — skipped (no ${kind} queries)` };
  }
  const value = byKind[kind] ?? 0;
  const ok = value >= floor - 1e-9;
  return { ok, line: `${ok ? "PASS" : "FAIL"}  ${label} = ${value.toFixed(3)} (want >= ${floor.toFixed(3)})` };
}

/** The five deterministic-tier quality gates. Performance never gates. */
export function evaluateGates(report: BenchReport): GateResult {
  const identifierR1 = report.legs.fused.recallAt1.byKind["identifier"] ?? 0;
  const identOk = Math.abs(identifierR1 - 1) < 1e-9;

  const hybridR5 = report.legs.fused.recallAt5.mean;
  const vectorR5 = report.legs.vector.recallAt5.mean;
  const r5Ok = hybridR5 >= vectorR5;

  const bestSingleMrr = Math.max(report.legs.vector.mrr.mean, report.legs.lexical.mrr.mean);
  const hybridMrr = report.legs.fused.mrr.mean;
  const mrrOk = hybridMrr >= bestSingleMrr - MRR_SLACK;

  const paraphrase = kindFloorLine(
    "paraphrase fused Recall@1",
    report.legs.fused.recallAt1.byKind,
    "paraphrase",
    PARAPHRASE_FUSED_R1_FLOOR,
  );
  const noTerm = kindFloorLine(
    "no-term fused Recall@5",
    report.legs.fused.recallAt5.byKind,
    "no-term",
    NO_TERM_FUSED_R5_FLOOR,
  );

  const lines = [
    `${identOk ? "PASS" : "FAIL"}  identifier Recall@1 = ${identifierR1.toFixed(3)} (want 1.000)`,
    `${r5Ok ? "PASS" : "FAIL"}  hybrid Recall@5 (${hybridR5.toFixed(3)}) >= vector Recall@5 (${vectorR5.toFixed(3)})`,
    `${mrrOk ? "PASS" : "FAIL"}  hybrid MRR (${hybridMrr.toFixed(3)}) >= max(vector, lexical) MRR (${bestSingleMrr.toFixed(3)}) - ${String(MRR_SLACK)}`,
    paraphrase.line,
    noTerm.line,
  ];
  return { passed: identOk && r5Ok && mrrOk && paraphrase.ok && noTerm.ok, lines };
}

export function markdownSummary(report: BenchReport): string {
  const row = (leg: LegName): string => {
    const m = report.legs[leg];
    return `| ${leg.padEnd(7)} | ${m.recallAt1.mean.toFixed(3)} | ${m.recallAt5.mean.toFixed(3)} | ${m.mrr.mean.toFixed(3)} |`;
  };
  const perf = report.performance;
  return [
    `## Retrieval benchmark — engine: ${report.engine} (${report.gitSha})`,
    "",
    `Queries: ${String(report.queryCount)}`,
    "",
    "| leg     | Recall@1 | Recall@5 | MRR   |",
    "|---------|----------|----------|-------|",
    row("vector"),
    row("lexical"),
    row("fused"),
    "",
    "### Per-kind fused Recall@1",
    ...Object.entries(report.legs.fused.recallAt1.byKind).map(
      ([kind, value]) => `- ${kind}: ${value.toFixed(3)}`,
    ),
    "",
    "### Performance (report-only)",
    `- index wall: ${perf.indexWallMs.toFixed(1)} ms for ${String(perf.chunkCount)} chunks (${perf.chunksPerSec.toFixed(0)} chunks/sec)`,
    `- passages: ${String(perf.passageCount)}; db size: ${String(perf.dbSizeBytes)} bytes`,
    `- search p50/p95: ${perf.searchP50Ms.toFixed(2)} / ${perf.searchP95Ms.toFixed(2)} ms`,
  ].join("\n");
}

export interface PrintContext {
  report: BenchReport;
  engine: Engine;
  treeSitter: boolean;
  reportPath: string;
  gates: GateResult;
  delta: ReportDelta | undefined;
  json: boolean;
}

/** Render a completed benchmark run to stdout. */
export function printOutcome(ctx: PrintContext): void {
  if (ctx.json) {
    console.log(JSON.stringify(ctx.report, null, 2));
    return;
  }
  console.log(markdownSummary(ctx.report));
  console.log("");
  console.log(`Tree-sitter chunking: ${ctx.treeSitter ? "enabled" : "unavailable (raw-text fallback)"}`);
  console.log(`Report written to ${path.relative(PROJECT_ROOT, ctx.reportPath)}`);
  if (ctx.engine === "deterministic") {
    console.log("");
    console.log("Gates (deterministic tier):");
    for (const line of ctx.gates.lines) console.log(`  ${line}`);
  }
  if (ctx.delta !== undefined) {
    console.log("");
    console.log(`Baseline comparison: ${ctx.delta.regressed ? "REGRESSED" : "ok"}`);
    for (const d of ctx.delta.deltas.filter((entry) => entry.regressed)) {
      console.log(`  REGRESSION ${d.name}: ${d.base.toFixed(3)} -> ${d.current.toFixed(3)}`);
    }
  }
}
