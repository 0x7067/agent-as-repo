# End-to-End Pipeline Test + Benchmark Spec

Date: 2026-07-05
Status: proposed
Depends on: hybrid BM25+vector search (`docs/plans/2026-07-05-hybrid-search-spec.md`, landed)

## Why

Every pipeline stage is tested in isolation — chunker, file collector, sqlite
store, provider send loop — but nothing exercises the actual product flow as
one path: `config.yaml → collect → chunk → embed → store → hybrid retrieve →
agent answer`. Three gaps follow:

1. **No end-to-end correctness test.** A regression that only appears when
   stages compose (e.g. chunk `FILE:` headers not surviving into FTS, state
   bookkeeping drifting from the store, sync deleting the wrong passages)
   is invisible to the unit suite.
2. **No retrieval numbers.** Hybrid search just landed justified by
   adversarial micro-cases. We cannot say "hybrid improves Recall@5 by X on
   a realistic corpus" or detect a future ranking regression.
3. **No performance baseline.** Indexing throughput and search latency are
   unmeasured; a 10× slowdown in chunking or a pathological FTS query plan
   would ship silently.

`eval/tasks.json` already defines answer-quality rubrics
(correct/grounded/useful/format_followed with `must_include` checks) but has
no runner. This spec gives it one, and adds the retrieval/performance layers
beneath it.

## Design overview

Two tiers with different budgets and guarantees:

| Tier | Entry point | Runs in CI? | Determinism | Gates |
|---|---|---|---|---|
| **E2E pipeline test** | `pnpm test` (vitest) | yes, every push | fully deterministic (stub embedder + scripted LLM server) | hard assertions |
| **Benchmark** | `pnpm bench` (`tsx eval/bench.ts`) | optional job, also local | deterministic tier gated; real-model tier report-only | quality thresholds only |

Both tiers drive the same pipeline code; neither introduces new
dependencies. All metric math is pure and lives in `src/core/`; all I/O
(temp dirs, git, HTTP stub server, process timing) lives in the shell or
`eval/`.

### Fixture corpus — `eval/fixtures/mini-corpus/`

A small checked-in source tree (~30 files, ~60 KB) spanning the chunker's
main languages (ts, py, go, java, rb, plus one raw-fallback `.md`/`.yaml`),
written for this purpose with **planted retrieval targets**:

- unique `camelCase` and `snake_case` identifiers (one definition site each)
- a distinctive error string (`"reconciliation ledger drift exceeded"`)
- a config key referenced from two files (multi-hit query)
- near-duplicate functions in two files (ranking discrimination)
- one file whose content is only reachable by paraphrase (no shared tokens
  with its gold query — vector-leg territory)

The corpus is static and versioned; changing it invalidates baselines, so
edits require regenerating `eval/baselines/` in the same PR. Tests never
mutate the fixture — the harness copies it into a temp dir and runs
`git init`/`git add`/`git commit` there (via `execFileSync` with arg
arrays), because setup and sync require a git repo.

### Gold set — `eval/retrieval-gold.json`

```jsonc
{
  "queries": [
    {
      "id": "ident-snake",
      "kind": "identifier",        // identifier | paraphrase | error-string | config-key | no-term
      "query": "where is compute_ledger_drift defined?",
      "expect_files": ["src/ledger/drift.py"],   // matched via passage file_path / FILE: header
      "expect_rank": 1                            // optional; only identifier queries pin rank 1
    }
  ]
}
```

Gold labels are **file paths, not passage IDs** (IDs are generated at index
time); a result counts as relevant when its passage's source path — from
`extractSourcePath` on the stored text — is in `expect_files`. Schema is
validated with zod (`zod/v4`) in core. Target ≥ 20 queries: ~8 identifier,
~5 paraphrase, ~3 error-string, ~2 config-key, ~2 no-term/punctuation.

### Core (pure, no I/O) — `src/core/eval-metrics.ts`

```ts
/** rankedFiles: per-query ranked list of source paths; gold: expected paths. */
export function recallAtK(rankedFiles: readonly string[], gold: readonly string[], k: number): number;
export function reciprocalRank(rankedFiles: readonly string[], gold: readonly string[]): number;
/** Aggregate per-query values: mean, plus per-kind breakdown. */
export function aggregate(perQuery: ReadonlyArray<{ kind: string; value: number }>): EvalAggregate;
/** p50/p95 over duration samples; pure over supplied numbers (no clocks). */
export function percentiles(samples: readonly number[], ps: readonly number[]): number[];
/** Diff two benchmark reports; flags metric drops beyond tolerance. */
export function compareReports(base: BenchReport, current: BenchReport, tolerance: number): ReportDelta;
```

Plus `parseGoldSet` (zod) and the `BenchReport` type in `src/core/types.ts`
or colocated. Colocated tests, no mocks, no clocks — timing samples are
inputs, never measured in core.

### Shell seams

**1. Leg-isolated search (benchmark only).** The benchmark must score the
vector leg, lexical leg, and fusion separately to quantify hybrid uplift.
The `PassageStore` port does not change; `SqlitePassageStore` gains one
diagnostic method (not on the port, benchmark/tests only):

```ts
/** Diagnostic: per-leg rankings + fused result, same over-fetch as semanticSearch. */
searchLegs(agentId: string, query: string, limit: number):
  Promise<{ vector: PassageSearchResult[]; lexical: PassageSearchResult[]; fused: PassageSearchResult[] }>;
```

`semanticSearch` is reimplemented as `searchLegs(...).fused` truncated to
`limit`, so the diagnostic can never drift from production ranking.

**2. Scripted LLM endpoint — `src/shell/__test__/scripted-llm-server.ts`.**
A real `node:http` server on an ephemeral port speaking the two endpoints
`llm-client.ts` uses:

- `POST /v1/embeddings` → deterministic hash-based bag-of-words vectors
  (the lossy 4-char-truncating embedder from
  `passage-store.contract.test.ts`, extracted into a shared helper so both
  suites use one implementation).
- `POST /v1/chat/completions` → a script: first call returns an
  `archival_memory_search` tool call echoing the user's question as the
  query; second call returns an answer that quotes the `FILE:` paths of the
  tool result verbatim.

This keeps the entire HTTP surface real (request shapes, tool-call loop,
auth header handling) with zero LLM. Existing unit tests keep their
`vi.stubGlobal("fetch")` style; the server is for e2e only.

**3. CLI orchestration extraction.** The `setup` and `ask` actions are
currently inline in `src/cli.ts`. Mechanically extract their bodies into
`src/shell/setup-runner.ts` / `src/shell/ask-runner.ts` (no behavior
change; cli.ts actions become thin calls; existing `cli.test.ts` stays
green). The e2e test drives these runners in-process — child-process
spawning is not used (slow, flaky in CI; flag parsing is already covered by
`cli.test.ts`).

### Tier 1 — E2E pipeline test (`src/shell/e2e-pipeline.test.ts`)

Runs in `pnpm test`, budget < 15 s, real temp-file DB, scripted LLM server,
`LLM_BASE_URL` pointed at it. One `describe` walking the lifecycle in
order:

1. **setup**: copy fixture → temp git repo → run setup-runner. Assert:
   passage count > 0, every passage's `file_path` is inside the fixture,
   state file written, FTS row count equals passage count.
2. **retrieve**: `semanticSearch` for a planted `snake_case` identifier
   returns its passage at rank 1 (hybrid working through the real embed
   path, not the in-test stub).
3. **ask**: ask-runner returns an answer containing the gold `FILE:` path —
   proves provider loop → tool call → hybrid search → answer composition
   end to end.
4. **sync**: edit one fixture file + commit → sync-runner. Assert: old
   identifier no longer retrievable at rank 1, new identifier is; FTS and
   passages counts still equal (trigger integrity under the real write
   path).
5. **degrade**: drop `passage_fts` + triggers via a second connection →
   ask still answers from the vector leg (no throw).
6. **destroy**: agent gone from store; store file intact for other agents.

### Tier 2 — Benchmark (`eval/bench.ts`, `pnpm bench`)

Not part of `pnpm test`. Steps:

1. Index the fixture corpus into a temp store (same runners as tier 1).
2. For each gold query, call `searchLegs` and time it
   (`performance.now()`, shell-side); score all three rankings with core
   metrics.
3. Optionally (`--tasks`) run `eval/tasks.json` through the ask path and
   score rubric `must_include`/`must_not_include` checks — meaningful only
   with `--live`.
4. Emit `BenchReport` JSON to `eval/reports/<git-sha>.json` + a markdown
   summary table to stdout. `eval/reports/` is gitignored except
   `eval/baselines/deterministic.json`, the committed reference.
5. `--baseline <file>` runs `compareReports` and exits non-zero on gated
   regressions.

Embedder tiers:

- **deterministic** (default; CI-safe): scripted server embeddings. Gated:
  - identifier-kind Recall@1 = 1.0 (the hybrid guarantee)
  - hybrid Recall@5 ≥ vector-only Recall@5 (fusion never hurts)
  - hybrid MRR ≥ max(vector-only MRR, lexical-only MRR) − 0.05
- **local model** (`--engine transformersjs`, dev machines; model download
  needs network on first run): real small-model embeddings via the existing
  in-process engine. **Report-only** — numbers land in the report for human
  comparison, never gate.
- **live** (`--live`, explicit endpoint from config): full answer-quality
  eval against `eval/tasks.json`. Report-only, never CI.

Performance metrics (all tiers, always report-only — CI hardware variance
makes latency gates flaky): indexing wall time, chunks/sec, search p50/p95
per leg, DB file size.

### Config

No `config.yaml` changes. Benchmark knobs are CLI flags on `eval/bench.ts`
only. No new dependencies: HTTP server is `node:http`, timing is
`performance.now()`, metrics are arithmetic.

## TDD Plan (red → green, in order)

Phase 1 — core (no mocks):

1. `src/core/eval-metrics.test.ts`: recallAtK (hit/miss/k-cutoff/empty),
   reciprocalRank (rank 1, rank n, absent → 0), percentiles (odd/even
   sample counts, single sample), aggregate per-kind means, compareReports
   (regression beyond tolerance flagged, improvement not flagged).
2. `parseGoldSet`: valid file parses; unknown `kind`, empty `expect_files`,
   duplicate `id` rejected.

Phase 2 — shell seams:

3. Extract shared lossy stub embedder; contract tests keep passing
   unchanged (pure refactor, red only if behavior drifts).
4. `sqlite-store.test.ts`: `searchLegs` returns the same fused ranking as
   `semanticSearch`, and lexical leg is empty for a no-term query.
5. `scripted-llm-server.test.ts`: embeddings deterministic across calls;
   chat script emits tool call then final answer; malformed request → 400.
6. Extract setup-runner/ask-runner; `cli.test.ts` and existing shell tests
   stay green (mechanical move).

Phase 3 — tiers:

7. `e2e-pipeline.test.ts` lifecycle test (red against a deliberately broken
   wire-up first — e.g. assert FTS count before implementing the harness
   copy step correctly).
8. `eval/bench.ts` + `pnpm bench` script; generate and commit
   `eval/baselines/deterministic.json`; a vitest smoke test runs bench with
   `--limit 3` queries to keep the script itself from rotting.
9. Docs: `docs/architecture.md` gains a "Verification" paragraph (two
   tiers, what gates what); README gets the `pnpm bench` one-liner.

## Acceptance Criteria

- `pnpm test` green in < +15 s over current runtime; e2e test passes with
  no network access and no real model.
- `pnpm bench` on the deterministic tier passes all three quality gates and
  writes a report identical across two consecutive runs (bit-for-bit,
  timing fields excluded).
- Hybrid uplift is visible in the committed baseline: hybrid Recall@5 >
  vector-only Recall@5 on the gold set.
- `PassageStore` port unchanged; `searchLegs` exists only on
  `SqlitePassageStore`; core metrics import nothing from shell.
- No new dependencies in `package.json`; no mocks in core tests; ESLint
  green.

## Risks

- **Fixture overfitting**: planted identifiers make lexical wins easy. The
  paraphrase queries (zero token overlap) keep the vector leg honest; the
  real-model tier exists to sanity-check on non-synthetic embeddings.
- **cli.ts extraction churn**: setup/ask bodies are large. Mitigated by
  making phase-2 step 6 strictly mechanical (move + re-export), landing it
  as its own commit so the diff is reviewable as a move.
- **Baseline rot**: corpus or gold-set edits silently shift numbers.
  `compareReports` gates in CI make a stale committed baseline fail loudly;
  the rule is corpus/gold/baseline change together in one PR.
- **Bench script rot**: covered by the `--limit 3` vitest smoke test so the
  script is executed on every push even though full bench is not.
