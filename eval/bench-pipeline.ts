/**
 * Benchmark pipeline: copy the fixture corpus into a temp git repo, index it
 * through the real collect -> chunk -> enrich -> store path, and score each
 * gold query's vector/lexical/fused legs. Shell-only (I/O, timing); all metric
 * math is delegated to the pure core in src/core/eval-metrics.ts.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { extractSourcePath, rawTextStrategy } from "../src/core/chunker.js";
import { enrichChunks } from "../src/core/chunk-context.js";
import { DEFAULT_EXTENSIONS, DEFAULT_IGNORE_DIRS, DEFAULT_TRANSFORMERSJS_EMBEDDING_MODEL } from "../src/core/config.js";
import {
  aggregate,
  recallAtK,
  reciprocalRank,
  type GoldQuery,
  type LegMetrics,
} from "../src/core/eval-metrics.js";
import {
  extractSymbolsAndRefsFromFile,
  initTreeSitterChunker,
  treeSitterStrategy,
} from "../src/core/tree-sitter-chunker.js";
import type { Chunk, ChunkingStrategy, FileInfo, RepoConfig } from "../src/core/types.js";
import { collectFiles } from "../src/shell/file-collector.js";
import { createEmbedder, type EmbedderDeps } from "../src/shell/embedder-factory.js";
import { resolveTreeSitterWasmPaths } from "../src/shell/tree-sitter-paths.js";
import { SqlitePassageStore, type EmbedTexts } from "../src/shell/sqlite-store.js";
import { stubEmbed } from "../src/shell/__test__/stub-embedder.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(HERE, "..");
export const FIXTURE_DIR = path.join(HERE, "fixtures", "mini-corpus");
export const GOLD_PATH = path.join(HERE, "retrieval-gold.json");
export const REPORTS_DIR = path.join(HERE, "reports");
export const AGENT_ID = "bench";
export const SEARCH_LIMIT = 10;
export const LEG_NAMES = ["vector", "lexical", "fused"] as const;
export type LegName = (typeof LEG_NAMES)[number];
export type Engine = "deterministic" | "transformersjs" | "http";

/** Overrides needed to build the `--engine http` embedder; apiKey is required in practice (checked by the bench entry point, not here). */
export interface HttpEngineParams {
  model: string;
  baseUrl: string;
  apiKey?: string;
}

/** Default embedding model for `--engine http` when `--model` is not given. */
export const DEFAULT_HTTP_EMBEDDING_MODEL = "openai/text-embedding-3-small";
/** Default base URL for `--engine http` when `--base-url` and `LLM_BASE_URL` are both unset. */
export const DEFAULT_HTTP_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Source file path a passage came from: the FILE: header, stripped of the
 * tree-sitter ` | KIND: name` symbol suffix so it matches gold file labels.
 */
export function goldPath(text: string): string | null {
  const raw = extractSourcePath(text);
  if (raw === null) return null;
  const pipe = raw.indexOf(" | ");
  return pipe === -1 ? raw : raw.slice(0, pipe);
}

function buildChunks(files: readonly FileInfo[], strategy: ChunkingStrategy): Chunk[] {
  const chunks: Chunk[] = [];
  for (const file of files) {
    const { refs } = extractSymbolsAndRefsFromFile(file);
    chunks.push(...enrichChunks(strategy(file), refs));
  }
  return chunks;
}

/** Prepare the tree-sitter chunker like production; fall back to raw text. */
export async function prepareChunking(): Promise<{ strategy: ChunkingStrategy; treeSitter: boolean }> {
  try {
    await initTreeSitterChunker(resolveTreeSitterWasmPaths({ packageRoot: PROJECT_ROOT }));
    return { strategy: treeSitterStrategy, treeSitter: true };
  } catch {
    return { strategy: rawTextStrategy, treeSitter: false };
  }
}

/**
 * Build the embedder for a given engine. `http` (report-only, like
 * transformersjs) requires `httpParams` and routes through the shared
 * `createEmbedder` factory — the same wiring the CLI/MCP provider path uses —
 * so nomic-style task prefixes and llm-client conventions are reused rather
 * than reimplemented here. `deps` lets tests inject a fake HTTP embed
 * function without hitting the network.
 */
export function makeEmbedder(engine: Engine, httpParams?: HttpEngineParams, deps?: EmbedderDeps): EmbedTexts {
  if (engine === "transformersjs") {
    // Report-only tier: real in-process embeddings (needs a model download).
    return createEmbedder({ engine: "transformersjs", model: DEFAULT_TRANSFORMERSJS_EMBEDDING_MODEL, baseUrl: "" }, deps);
  }
  if (engine === "http") {
    // Report-only tier: real OpenAI-compatible remote embeddings (e.g. OpenRouter).
    if (httpParams === undefined) {
      throw new Error('makeEmbedder("http", ...) requires model/baseUrl params');
    }
    return createEmbedder({ engine: "http", ...httpParams }, deps);
  }
  // Deterministic tier: the stub is constructed directly (no createEmbedder),
  // so per-task prefixes never pollute the bag-of-words vectors.
  return stubEmbed;
}

export interface IndexOutcome {
  store: SqlitePassageStore;
  chunkCount: number;
  passageCount: number;
  indexWallMs: number;
  dbSizeBytes: number;
  cleanup: () => void;
}

function gitInit(corpusDir: string): void {
  const run = (args: string[]): void => {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
    execFileSync("git", args, { cwd: corpusDir });
  };
  run(["init", "-q"]);
  run(["config", "user.email", "bench@example.com"]);
  run(["config", "user.name", "bench"]);
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "fixture"]);
}

export async function indexCorpus(embed: EmbedTexts, strategy: ChunkingStrategy): Promise<IndexOutcome> {
  const workDir = mkdtempSync(path.join(tmpdir(), "repo-expert-bench-"));
  const corpusDir = path.join(workDir, "corpus");
  cpSync(FIXTURE_DIR, corpusDir, { recursive: true });
  // Setup + sync require a git repo; init one over the copy (never the fixture).
  gitInit(corpusDir);

  const repoConfig: RepoConfig = {
    path: corpusDir,
    description: "mini-corpus",
    extensions: DEFAULT_EXTENSIONS,
    ignoreDirs: DEFAULT_IGNORE_DIRS,
  };

  const dbPath = path.join(workDir, "store.db");
  const store = new SqlitePassageStore({ dbPath, embed });
  await store.initAgent(AGENT_ID, {
    agentId: AGENT_ID,
    name: "bench",
    model: "stub",
    tags: [],
    createdAt: "2026-07-05T00:00:00.000Z",
  });

  const start = performance.now();
  const files = await collectFiles(repoConfig);
  const chunks = buildChunks(files, strategy);
  await store.writePassages(
    AGENT_ID,
    chunks.map((chunk, index) => ({ passageId: `p-${String(index)}`, text: chunk.text })),
  );
  const indexWallMs = performance.now() - start;

  const passages = await store.listPassages(AGENT_ID);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- app-owned temp DB path
  const dbSizeBytes = statSync(dbPath).size;

  return {
    store,
    chunkCount: chunks.length,
    passageCount: passages.length,
    indexWallMs,
    dbSizeBytes,
    cleanup: () => {
      store.close();
      rmSync(workDir, { recursive: true, force: true });
    },
  };
}

export interface ScoredLegs {
  perLeg: Record<LegName, LegMetrics>;
  searchDurationsMs: number[];
}

interface KindValue {
  kind: string;
  value: number;
}
interface LegSamples {
  r1: KindValue[];
  r5: KindValue[];
  rr: KindValue[];
}

export async function scoreQueries(
  store: SqlitePassageStore,
  queries: readonly GoldQuery[],
): Promise<ScoredLegs> {
  const samples: Record<LegName, LegSamples> = {
    vector: { r1: [], r5: [], rr: [] },
    lexical: { r1: [], r5: [], rr: [] },
    fused: { r1: [], r5: [], rr: [] },
  };
  const searchDurationsMs: number[] = [];

  for (const query of queries) {
    const start = performance.now();
    const legs = await store.searchLegs(AGENT_ID, query.query, SEARCH_LIMIT);
    searchDurationsMs.push(performance.now() - start);

    for (const leg of LEG_NAMES) {
      const ranked = legs[leg]
        .map((result) => goldPath(result.text))
        .filter((file): file is string => file !== null);
      samples[leg].r1.push({ kind: query.kind, value: recallAtK(ranked, query.expect_files, 1) });
      samples[leg].r5.push({ kind: query.kind, value: recallAtK(ranked, query.expect_files, 5) });
      samples[leg].rr.push({ kind: query.kind, value: reciprocalRank(ranked, query.expect_files) });
    }
  }

  const perLeg = Object.fromEntries(
    LEG_NAMES.map((leg) => [
      leg,
      {
        recallAt1: aggregate(samples[leg].r1),
        recallAt5: aggregate(samples[leg].r5),
        mrr: aggregate(samples[leg].rr),
      },
    ]),
  ) as Record<LegName, LegMetrics>;

  return { perLeg, searchDurationsMs };
}
