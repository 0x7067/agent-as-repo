/**
 * Retrieval-quality benchmark (Tier 2 of the e2e/benchmark spec), wired as
 * `pnpm bench`. Indexes the checked-in fixture corpus through the real
 * pipeline, runs every gold query through the leg-isolated `searchLegs`
 * diagnostic, scores vector/lexical/fused legs with the pure core metrics, and
 * emits a BenchReport JSON to eval/reports/<git-sha>.json plus a markdown
 * summary on stdout.
 *
 * Deterministic tier (default): the shared hash bag-of-words stub embedder — no
 * network, no model, three quality gates. `--engine transformersjs` swaps in
 * real in-process embeddings (report-only; needs a model download, not CI).
 * Performance numbers are always report-only.
 *
 * Flags: --engine transformersjs | --baseline <file> | --limit <n> | --json
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  compareReports,
  parseGoldSet,
  percentiles,
  type BenchReport,
  type ReportDelta,
} from "../src/core/eval-metrics.js";
import { isMainModule } from "../src/shell/is-main-module.js";
import {
  GOLD_PATH,
  PROJECT_ROOT,
  REPORTS_DIR,
  indexCorpus,
  makeEmbedder,
  prepareChunking,
  scoreQueries,
  type Engine,
} from "./bench-pipeline.js";
import { evaluateGates, printOutcome } from "./bench-report.js";

export { evaluateGates } from "./bench-report.js";

const REGRESSION_TOLERANCE = 0.02;

export interface BenchOptions {
  engine?: Engine;
  limit?: number;
  baseline?: string;
  json?: boolean;
  /** Suppress stdout (used by the smoke test). */
  quiet?: boolean;
}

export interface BenchOutcome {
  report: BenchReport;
  delta?: ReportDelta;
  gatesPassed: boolean;
}

function gitShortSha(): string {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: PROJECT_ROOT }).toString().trim();
  } catch {
    return "unknown";
  }
}

function loadBaseline(baselinePath: string, report: BenchReport): ReportDelta {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- user-supplied baseline path
  const base = JSON.parse(readFileSync(baselinePath, "utf8")) as BenchReport;
  return compareReports(base, report, REGRESSION_TOLERANCE);
}

function writeReport(report: BenchReport): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- app-owned reports dir
  mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = path.join(REPORTS_DIR, `${report.gitSha}.json`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- app-owned reports dir
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  return reportPath;
}

export async function runBench(options: BenchOptions = {}): Promise<BenchOutcome> {
  const engine = options.engine ?? "deterministic";
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed, code-defined gold-set path
  const goldSet = parseGoldSet(JSON.parse(readFileSync(GOLD_PATH, "utf8")));
  const queries = options.limit === undefined ? goldSet.queries : goldSet.queries.slice(0, options.limit);

  const { strategy, treeSitter } = await prepareChunking();
  const indexed = await indexCorpus(makeEmbedder(engine), strategy);
  try {
    const { perLeg, searchDurationsMs } = await scoreQueries(indexed.store, queries);
    const durations = percentiles(searchDurationsMs, [50, 95]);
    const report: BenchReport = {
      engine,
      gitSha: gitShortSha(),
      queryCount: queries.length,
      legs: perLeg,
      performance: {
        indexWallMs: indexed.indexWallMs,
        chunkCount: indexed.chunkCount,
        passageCount: indexed.passageCount,
        chunksPerSec: indexed.indexWallMs > 0 ? (indexed.chunkCount / indexed.indexWallMs) * 1000 : 0,
        dbSizeBytes: indexed.dbSizeBytes,
        searchP50Ms: durations.at(0) ?? 0,
        searchP95Ms: durations.at(1) ?? 0,
      },
    };

    const reportPath = writeReport(report);
    const gates = evaluateGates(report);
    const delta = options.baseline === undefined ? undefined : loadBaseline(options.baseline, report);

    if (options.quiet !== true) {
      printOutcome({ report, engine, treeSitter, reportPath, gates, delta, json: options.json === true });
    }

    // Performance is report-only; gates apply only to the deterministic tier.
    const gatesPassed = engine === "deterministic" ? gates.passed : true;
    const baselineOk = delta === undefined || !delta.regressed;
    return { report, gatesPassed: gatesPassed && baselineOk, ...(delta === undefined ? {} : { delta }) };
  } finally {
    indexed.cleanup();
  }
}

function parseArgs(argv: readonly string[]): BenchOptions {
  const options: BenchOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--engine": {
        if (argv.at(++i) === "transformersjs") options.engine = "transformersjs";
        break;
      }
      case "--baseline": {
        const value = argv.at(++i);
        if (value !== undefined) options.baseline = value;
        break;
      }
      case "--limit": {
        const value = Number(argv.at(++i));
        if (Number.isSafeInteger(value) && value > 0) options.limit = value;
        break;
      }
      case "--json": {
        options.json = true;
        break;
      }
      default: {
        break;
      }
    }
  }
  return options;
}

async function main(): Promise<void> {
  const outcome = await runBench(parseArgs(process.argv.slice(2)));
  if (!outcome.gatesPassed) process.exitCode = 1;
}

if (isMainModule(import.meta.url)) {
  void main();
}
