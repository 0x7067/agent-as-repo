/** Benchmark gates, markdown summary, and stdout rendering. */
import path from "node:path";

import type { BenchReport, ReportDelta } from "../src/core/eval-metrics.js";
import { PROJECT_ROOT, type Engine, type LegName } from "./bench-pipeline.js";

const MRR_SLACK = 0.05;

export interface GateResult {
  passed: boolean;
  lines: string[];
}

/** The three deterministic-tier quality gates. Performance never gates. */
export function evaluateGates(report: BenchReport): GateResult {
  const identifierR1 = report.legs.fused.recallAt1.byKind["identifier"] ?? 0;
  const identOk = Math.abs(identifierR1 - 1) < 1e-9;

  const hybridR5 = report.legs.fused.recallAt5.mean;
  const vectorR5 = report.legs.vector.recallAt5.mean;
  const r5Ok = hybridR5 >= vectorR5;

  const bestSingleMrr = Math.max(report.legs.vector.mrr.mean, report.legs.lexical.mrr.mean);
  const hybridMrr = report.legs.fused.mrr.mean;
  const mrrOk = hybridMrr >= bestSingleMrr - MRR_SLACK;

  const lines = [
    `${identOk ? "PASS" : "FAIL"}  identifier Recall@1 = ${identifierR1.toFixed(3)} (want 1.000)`,
    `${r5Ok ? "PASS" : "FAIL"}  hybrid Recall@5 (${hybridR5.toFixed(3)}) >= vector Recall@5 (${vectorR5.toFixed(3)})`,
    `${mrrOk ? "PASS" : "FAIL"}  hybrid MRR (${hybridMrr.toFixed(3)}) >= max(vector, lexical) MRR (${bestSingleMrr.toFixed(3)}) - ${String(MRR_SLACK)}`,
  ];
  return { passed: identOk && r5Ok && mrrOk, lines };
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
