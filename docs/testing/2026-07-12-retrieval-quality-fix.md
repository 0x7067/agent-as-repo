# Retrieval quality: paraphrase/no-term fix (2026-07-12)

Closes the one deferred finding from the 2026-07-11 sessions (findings doc
item 13/14): paraphrase and no-term retrieval quality. Method: harden the
measurement first, diagnose per query, change one thing, re-gate.

## 1. Measurement hardening (before any retrieval change)

- **`--engine http`** added to `eval/bench.ts` (2ecee66): benches any
  OpenAI-compatible embeddings endpoint (default
  `openai/text-embedding-3-small` via OpenRouter, `LLM_API_KEY` from `.env`),
  routed through the shared `createEmbedder` factory — the A/B that was
  impossible last session. Report files are now engine-suffixed
  (`<sha>-<engine>.json`) so multi-engine runs don't overwrite each other.
- **Gold set grown** (f3cd9f1): paraphrase 5 → 15, no-term 2 → 22 queries
  (51 total). One query was 0.2–0.5 Recall granularity — too coarse to
  optimize against. New, test-enforced bucket semantics
  (`eval/retrieval-gold.test.ts`): a *no-term* query shares zero
  non-stopword `\w+` tokens with its gold file (pure-semantic retrieval); a
  *paraphrase* query leaks no identifiers from its gold file. The two old
  punctuation queries (`!!! ??? ---`) were removed: they had no
  corresponding fixture content, so they measured embedding-geometry noise
  (the punctuation robustness path stays unit-tested in
  `sqlite-store.test.ts`). Every query was verified against fixture content
  twice (author pass + independent reviewer pass).
- **All three engines re-baselined** on the expanded set and committed
  (b71d82f) before touching retrieval.

### Before (51 queries, fused leg)

| engine | R@1 | R@5 | MRR | para R@1 | no-term R@1 | vector-only R@1 / MRR |
|---|---|---|---|---|---|---|
| deterministic | 0.353 | 0.578 | 0.482 | 0.200 | 0.091 | 0.235 / 0.373 |
| transformersjs | 0.529 | 0.843 | 0.676 | 0.600 | 0.227 | 0.667 / 0.788 |
| http (te3-small) | 0.529 | 0.961 | 0.710 | 0.667 | 0.227 | 0.755 / 0.845 |

The headline was already visible here: **with real embeddings, the vector
leg alone beat the fused production ranking** — fusion was destroying
quality, not adding it.

## 2. Diagnosis (per failing query, both real engines)

Every paraphrase/no-term query with fused rank > 1 was classified from its
per-leg rankings (throwaway script over `searchLegs`; replaying the
production fusion over the dumped rankings reproduced every observed rank,
0 mismatches):

| class | meaning | http | transformersjs |
|---|---|---|---|
| (a) vector never retrieves gold in top-10 → chunking/embedding | 3 | 6 |
| (b) vector has gold at rank ≤ 3, fusion buries it → fusion weighting | **19** | **17** |
| (c) gold chunk is a bad/context-poor slice → chunk enrichment | 0 primary | 0 primary |

Mechanism for (b), unweighted RRF `k=60`: a rank-1 single-leg hit scores
`1/61 ≈ 0.0164`, while a file at rank ~20 in *both* legs scores
`1/80 + 1/80 = 0.025`. No-term gold files are absent from the lexical leg
*by construction*, while FTS5's OR-matching hands junk files a lexical
contribution via stopword/common-word matches — so dual-leg mediocrity
systematically outranked single-leg excellence. Two small prose docs
(`runbook.md`, `architecture-notes.md`) acted as recurring dual-leg "hub"
false positives. Example (para-runbook, http): gold at vector rank 1 =
`0.0164`; winner `thresholds.py` (vec 14, lex 2) = `1/74 + 1/62 = 0.0296`.

Secondary (c)-adjacent observation, not fixed: tree-sitter chunks tiny files
per declaration (e.g. `pkg/queue/worker.go`, 641 bytes → 3 passages),
fragmenting one file's RRF signal across ids while a wrong file concentrates
its signal in one id.

## 3. Fix: weighted fused RRF (64345cc)

One change: the fused leg now uses **k=10 with vector weight 2, lexical
weight 1** (`FUSED_RRF_K`, `FUSED_VECTOR_WEIGHT`, `FUSED_LEXICAL_WEIGHT` in
`src/core/hybrid-rank.ts`; `rrfFuse` gained an optional per-list `weights`
param, unweighted behavior unchanged). Chosen from a 36-config offline sweep
(k ∈ {5,10,20,60} × weights {1:1, 2:1, 3:1} × lexical depth {5,10,30})
replayed over the real per-leg rankings of all three engines:

- k=5 and/or 3:1 score higher raw MRR but **break the identifier R@1 = 1.0
  gate** (deterministic) and the config-key lexical rescue (http) — rejected.
- Lexical depth capping is strictly dominated once weighting is applied.
- Queries that rely on lexical rescue (identifier/error-string/config-key
  where vector misses rank 1) were enumerated first and verified unharmed.

### After (51 queries, fused leg)

| engine | R@1 | R@5 | MRR | para R@1 | no-term R@1 |
|---|---|---|---|---|---|
| deterministic | 0.333 (−0.020) | 0.539 (−0.039) | 0.464 (−0.018) | 0.200 (=) | 0.091 (=) |
| transformersjs | **0.627** (+0.098) | **0.922** (+0.079) | **0.756** (+0.080) | 0.600 (=) | **0.455** (+0.228) |
| http (te3-small) | **0.725** (+0.196) | **0.971** (+0.010) | **0.828** (+0.118) | **0.800** (+0.133) | **0.591** (+0.364) |

The deterministic stub tier consciously trades one ambiguous stub-only
query (`err-drift`: fused rank 1 → 2, still top-5; the near-tie
reconcile.ts-vs-drift.py flagged during diagnosis) for the weighting that
real engines need. All five deterministic gates pass; the fused leg now
tracks the vector leg's quality on real engines instead of dragging it down
(http fused MRR 0.828 vs vector-only 0.845).

### Left unfixed (documented failure classes)

- **Class (a)** — 3 (http) / 6 (transformersjs) queries where the vector leg
  itself misses top-10 (`para-yaml-digest`, `noterm-reconcile`,
  `noterm-drift-py`, plus transformersjs-only misses like
  `noterm-thresholds-py`): genuine embedding/chunking limits; candidate
  follow-ups are chunk-context enrichment for YAML/config files and merging
  per-declaration chunks of tiny files (the `worker.go` fragmentation above).
- **Query-side expansion/prefixing**: untouched — fusion weighting recovered
  most of the gap without adding a query-transformation layer.

## 4. Gating (97cbe6f)

`evaluateGates` grew from 3 to 5 deterministic-tier gates:

```
PASS  identifier Recall@1 = 1.000 (want 1.000)
PASS  hybrid Recall@5 (0.539) >= vector Recall@5 (0.471)
PASS  hybrid MRR (0.464) >= max(vector, lexical) MRR (0.489) - 0.05
PASS  paraphrase fused Recall@1 = 0.200 (want >= 0.200)
PASS  no-term fused Recall@5 = 0.227 (want >= 0.200)
```

The two floors sit at the stub embedder's expressiveness limit — smoke
floors so the buckets can never silently regress to zero again (before this
session they were entirely ungated). Real-embedding expectations are pinned
by the committed `eval/baselines/{transformersjs,http}.json`; regression-gate
a change with `pnpm bench --engine transformersjs --baseline
eval/baselines/transformersjs.json` (same for `http`). Expected ranges at
these baselines: transformersjs fused MRR ≈ 0.76 / no-term R@1 ≈ 0.45;
http fused MRR ≈ 0.83 / no-term R@1 ≈ 0.59.

## 5. Live spot-check (flask, OpenRouter http engine)

Isolated workspace, 1197 passages. The finding-14 misattribution repro
(watch/sync-added note answered with the wrong file attribution two runs in
a row) **no longer reproduces**: a freshly committed
`docs/internal/team-sync-note.md` was retrieved (rank 2) and correctly
attributed on **2/2 runs** of a zero-term paraphrase ask ("end-of-year
deploy moratorium… who must be contacted"), answer verbatim-faithful to the
note. Three additional paraphrase asks (request→view dispatch, post-response
teardown, config-from-file) each retrieved exactly the right symbols
(`dispatch_request`/`full_dispatch_request`, `finalize_request`/
`do_teardown_request`, `Config.from_file`/`from_envvar`) with grounded
answers — 5/5 overall.

## Suite state

1451 passed / 1 skipped (`node_modules/.bin/vitest run`), typecheck and
lint clean, bench gates 5/5, baseline comparisons ok. Bench reports for the
before/after numbers: `f3cd9f1-*` (before) and `b71d82f-*`/`64345cc-*`
(after) shas in this doc's tables.
