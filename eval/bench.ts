/**
 * Retrieval-quality benchmark (Tier 2 of the e2e/benchmark spec), wired as
 * `pnpm bench`. Indexes the checked-in fixture corpus through the real
 * pipeline, runs every gold query through the leg-isolated `searchLegs`
 * diagnostic, scores vector/lexical/fused legs with the pure core metrics, and
 * emits a BenchReport JSON to eval/reports/<git-sha>.json plus a markdown
 * summary on stdout.
 *
 * Deterministic tier (default): the shared hash bag-of-words stub embedder — no
 * network, no model, three quality gates. `--engine transformersjs` and
 * `--engine http` swap in real embeddings (report-only; deterministic gates
 * never apply to them) — transformersjs runs in-process (needs a model
 * download, not CI), http calls a real OpenAI-compatible embeddings endpoint
 * (e.g. OpenRouter) and needs LLM_API_KEY. Performance numbers are always
 * report-only.
 *
 * Flags:
 *   --engine deterministic|transformersjs|http  (default: deterministic)
 *   --model <id>       http engine embedding model id (default: openai/text-embedding-3-small)
 *   --base-url <url>   http engine base URL (default: $LLM_BASE_URL, else https://openrouter.ai/api/v1)
 *   --baseline <file>  compare against a previously saved BenchReport JSON
 *   --limit <n>        only run the first n gold queries
 *   --json             emit the BenchReport as JSON instead of the markdown summary
 *
 * `--engine http` reads its API key from LLM_API_KEY (.env or the
 * environment, same convention as the CLI) and fails fast with a clear error
 * if it's missing — before any indexing or network access.
 */
import "dotenv/config";
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
  DEFAULT_HTTP_BASE_URL,
  DEFAULT_HTTP_EMBEDDING_MODEL,
  GOLD_PATH,
  PROJECT_ROOT,
  REPORTS_DIR,
  indexCorpus,
  makeEmbedder,
  prepareChunking,
  scoreQueries,
  type Engine,
  type HttpEngineParams,
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
  /** `--engine http` embedding model override (default: DEFAULT_HTTP_EMBEDDING_MODEL). */
  model?: string;
  /** `--engine http` base URL override (default: $LLM_BASE_URL, else DEFAULT_HTTP_BASE_URL). */
  baseUrl?: string;
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
  // Engine-suffixed so multi-engine runs at one sha don't overwrite each other.
  const reportPath = path.join(REPORTS_DIR, `${report.gitSha}-${report.engine}.json`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- app-owned reports dir
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  return reportPath;
}

/**
 * Resolve the `--engine http` embedder params, failing fast (before any
 * indexing or network access) with a clear message when no API key is
 * available. Precedence: CLI flag > env var > default (OpenRouter's
 * `text-embedding-3-small` model / base URL).
 */
export function resolveHttpEngineParams(options: BenchOptions): HttpEngineParams {
  const apiKey = process.env["LLM_API_KEY"];
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error(
      "--engine http requires an LLM_API_KEY (set it in .env or the environment) to authenticate with the embeddings endpoint.",
    );
  }
  return {
    model: options.model ?? DEFAULT_HTTP_EMBEDDING_MODEL,
    baseUrl: options.baseUrl ?? process.env["LLM_BASE_URL"] ?? DEFAULT_HTTP_BASE_URL,
    apiKey,
  };
}

export async function runBench(options: BenchOptions = {}): Promise<BenchOutcome> {
  const engine = options.engine ?? "deterministic";
  // Fail fast on a missing API key before any file I/O, chunking, or indexing.
  const embedder = engine === "http" ? makeEmbedder("http", resolveHttpEngineParams(options)) : makeEmbedder(engine);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed, code-defined gold-set path
  const goldSet = parseGoldSet(JSON.parse(readFileSync(GOLD_PATH, "utf8")));
  const queries = options.limit === undefined ? goldSet.queries : goldSet.queries.slice(0, options.limit);

  const { strategy, treeSitter } = await prepareChunking();
  const indexed = await indexCorpus(embedder, strategy);
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

function isEngineFlagValue(value: string | undefined): value is Engine {
  return value === "transformersjs" || value === "http";
}

function parseLimitFlag(value: string | undefined, options: BenchOptions): void {
  const n = Number(value);
  if (Number.isSafeInteger(n) && n > 0) options.limit = n;
}

type FlagParser = (value: string | undefined, options: BenchOptions) => void;

function getFlagParser(record: Record<string, FlagParser>, key: string | undefined): FlagParser | undefined {
  if (key === undefined) return undefined;
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** Flags that take a single string value, applied one at a time so `parseArgs` stays a flat dispatch loop. */
const FLAG_PARSERS: Record<string, FlagParser> = {
  "--engine": (value, options) => {
    if (isEngineFlagValue(value)) options.engine = value;
  },
  "--model": (value, options) => {
    if (value !== undefined) options.model = value;
  },
  "--base-url": (value, options) => {
    if (value !== undefined) options.baseUrl = value;
  },
  "--baseline": (value, options) => {
    if (value !== undefined) options.baseline = value;
  },
  "--limit": parseLimitFlag,
};

export function parseArgs(argv: readonly string[]): BenchOptions {
  const options: BenchOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    const parser = getFlagParser(FLAG_PARSERS, arg);
    if (parser === undefined) continue;
    parser(argv.at(++i), options);
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
