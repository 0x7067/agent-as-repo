/**
 * Retrieval diagnosis: dump per-leg rankings (vector/lexical/fused) for gold
 * queries plus the chunk inventory of their gold files, over the same
 * indexCorpus/searchLegs pipeline the benchmark uses. This is the per-query
 * companion to eval/bench.ts's aggregates — use it to classify a failing
 * query (weak gold chunk vs fragment crowding vs embedder limit) before
 * changing any retrieval code.
 * Usage: tsx eval/dump-legs.ts [--engine deterministic|transformersjs|http] [--ids id1,id2]
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import type { GoldQuery } from "../src/core/eval-metrics.js";
import { isMainModule } from "../src/shell/is-main-module.js";
import {
  AGENT_ID,
  GOLD_PATH,
  goldPath,
  indexCorpus,
  makeEmbedder,
  prepareChunking,
  type Engine,
} from "./bench-pipeline.js";
import { resolveHttpEngineParams } from "./bench.js";

export const DEFAULT_IDS = [
  "para-yaml-digest",
  "noterm-reconcile",
  "noterm-drift-py",
  "para-runbook",
  "para-emailer",
  "noterm-thresholds-py",
  "noterm-token-go",
];

const ENGINES: readonly Engine[] = ["deterministic", "transformersjs", "http"];

function isEngine(value: string): value is Engine {
  return (ENGINES as readonly string[]).includes(value);
}

/**
 * A wrong diagnosis is worse than no diagnosis, so a malformed flag errors
 * instead of silently falling back (an unvalued `--engine` used to fall
 * through to the deterministic stub and print its rankings as if they came
 * from the requested engine).
 */
export function parseArgs(argv: string[]): { engine: Engine; ids: string[] } {
  const engineIdx = argv.indexOf("--engine");
  let engine: Engine = "transformersjs";
  if (engineIdx !== -1) {
    const raw = argv.at(engineIdx + 1);
    if (raw === undefined || !isEngine(raw)) {
      throw new Error(
        `--engine requires one of: ${ENGINES.join(", ")} (got ${raw ?? "no value"})`,
      );
    }
    engine = raw;
  }
  const idsIdx = argv.indexOf("--ids");
  let ids = DEFAULT_IDS;
  if (idsIdx !== -1) {
    ids = (argv.at(idsIdx + 1) ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    if (ids.length === 0) {
      throw new Error("--ids requires a comma-separated list of gold query ids");
    }
  }
  return { engine, ids };
}

async function main(): Promise<void> {
  const { engine, ids } = parseArgs(process.argv.slice(2));

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- repo-owned gold-set path constant
  const gold = JSON.parse(readFileSync(GOLD_PATH, "utf8")) as { queries: GoldQuery[] };
  const queries = gold.queries.filter((q) => ids.includes(q.id));
  const unknownIds = ids.filter((id) => !gold.queries.some((q) => q.id === id));
  if (unknownIds.length > 0) {
    throw new Error(`Unknown gold query id(s): ${unknownIds.join(", ")}`);
  }

  // Fail fast on a missing API key (same check as bench.ts) before any
  // indexing work; the other engines need no params.
  const embed = makeEmbedder(engine, engine === "http" ? resolveHttpEngineParams({}) : undefined);
  const { strategy, treeSitter } = await prepareChunking();
  console.log(`engine=${engine} treeSitter=${String(treeSitter)}`);

  const { store, cleanup } = await indexCorpus(embed, strategy);
  try {
    // Chunk inventory for every gold file of the selected queries.
    const passages = await store.listPassages(AGENT_ID);
    const goldFiles = new Set(queries.flatMap((q) => q.expect_files));
    console.log("\n=== chunk inventory (gold files) ===");
    for (const file of goldFiles) {
      const own = passages.filter((p) => goldPath(p.text) === file);
      console.log(`\n${file}: ${String(own.length)} passages`);
      for (const p of own) {
        const head = p.text.split("\n").slice(0, 2).join(" || ");
        console.log(`  [${p.id}] ${String(p.text.length)}ch  ${head.slice(0, 160)}`);
      }
    }

    for (const q of queries) {
      console.log(`\n=== ${q.id} (${q.kind}) gold=${q.expect_files.join(",")}`);
      console.log(`    "${q.query}"`);
      const legs = await store.searchLegs(AGENT_ID, q.query, 10);
      for (const leg of ["vector", "lexical", "fused"] as const) {
        const rows = legs[leg].map((r, i) => {
          const file = goldPath(r.text) ?? "?";
          const mark = q.expect_files.includes(file) ? " <== GOLD" : "";
          const sym = r.text.split("\n")[0]?.replace(`FILE: ${file}`, "").trim() ?? "";
          return `    ${leg[0]}${String(i + 1).padStart(2)}. ${file} ${sym}${mark}`;
        });
        console.log(rows.join("\n"));
      }
    }
  } finally {
    cleanup();
  }
}

if (isMainModule(import.meta.url)) {
  void main();
}
