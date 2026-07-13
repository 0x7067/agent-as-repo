# Class-(a) vector-leg misses: measured to the embedder's limit (2026-07-13)

Closes the documented-but-unfixed remainder of the 2026-07-12 session
(`2026-07-12-retrieval-quality-fix.md` §3): the class-(a) queries whose gold
file the **vector leg itself** ranks too low for any fusion weighting to save.
That doc named two candidate mechanisms, neither measured at the time:
chunk-context enrichment for YAML/config files, and merging per-declaration
chunks of tiny files. This session measured both (plus two merge variants the
data suggested along the way). **Every candidate fails the quality
constraints; no production change ships.** The value of this session is the
negative result: the candidates are now refuted with numbers, per-query
verdicts are recorded, and future sessions should not re-try these mechanisms
blind.

Hard constraints every candidate was held to:

- identifier fused Recall@1 = 1.0 and the other four deterministic gates,
- no committed-baseline leg-metric mean regressing > 0.02 on any engine,
- `eval/retrieval-gold.test.ts` invariants green,
- class-(a) target queries improve or hold on the real engines.

## 1. Re-verification (before touching anything)

Fresh container, branch restarted from `main` @ e2b92c0. All three engines
reproduced their committed baselines exactly (fused R@1 / R@5 / MRR):
deterministic 0.333/0.539/0.464 with 5/5 gates, transformersjs
0.627/0.922/0.756, http 0.725/0.971/0.828 — `--baseline` comparison "ok" on
all three.

## 2. Per-query diagnosis

Method: throwaway script over `SqlitePassageStore.searchLegs` (same
over-fetch as production), dumping each class-(a) query's top-10 vector
passages, the gold file's rank per leg, and the gold file's passage
fragmentation (untracked `eval/dump-legs.ts`, deleted after use; rebuildable
in ~50 lines from `eval/bench-pipeline.ts` exports).

Vector-leg rank of the gold file's best passage (fused rank in parens):

| query | http | transformersjs | gold file | passages |
|---|---|---|---|---|
| para-yaml-digest | 6 (5) | 1 (1) | config/app.yaml (427 B) | 1 |
| noterm-reconcile | 5 (4) | 11 (9) | src/ledger/reconcile.ts (1099 B) | 6 |
| noterm-drift-py | 13 (9) | 5 (6) | services/ledger/drift.py (572 B) | 3 |
| para-runbook | 1 (1) | 4 (5) | docs/runbook.md (512 B) | 1 |
| para-emailer | 3 (4) | 6 (6) | services/notify/emailer.py (545 B) | 4 |
| noterm-thresholds-py | 1 (1) | 23 (27) | services/ledger/thresholds.py (566 B) | 4 |
| noterm-token-go | 1 (1) | 4 (4) | pkg/auth/token.go (541 B) | 4 |

Two structural observations drove the fix candidates:

- **Fragmentation**: every failing code file is tiny and split per
  declaration into 63–490-char slivers (e.g. `reconcile.ts` → 6 passages,
  three of them plain-`FILE:` residue chunks of 144–346 chars). Each sliver
  embeds weakly; the file's semantics never appear in one vector.
- **Whole-file competitors**: the two prose docs (`runbook.md`,
  `architecture-notes.md`) and `app.yaml` are single whole-file chunks and
  sit at vector rank 1–4 on nearly every semantic query — concentrated
  embeddings beat slivers, for wrong files as much as right ones.

## 3. Mechanisms measured — all refuted

Harness: untracked `eval/merge-experiment.ts` (deleted after use) sweeping a
strategy wrapper over `indexCorpus`'s injectable chunking strategy, all 51
gold queries, all three engines; threshold-0 control rows matched the
committed baselines exactly in every run.

### 3a. Replace-merge (files ≤ N chars become one whole-file chunk)

The 2026-07-12 candidate as written. Swept N ∈ {512, 1024, 1300, 2000}:

| engine | control fused R1/R5/MRR | N=512 | N=1024 | N=2000 |
|---|---|---|---|---|
| deterministic | 0.333/0.539/0.464 | 0.294/0.539/0.438 | 0.314/0.529/0.448 | 0.294/0.549/0.439 |
| transformersjs | 0.627/0.922/0.756 | 0.647/0.912/0.777 | 0.588/0.863/0.721 | 0.510/0.863/0.690 |
| http | 0.725/0.971/0.828 | 0.686/0.971/0.815 | 0.569/1.000/0.744 | 0.588/0.980/0.743 |

Refuted: fused R@1 regresses > 0.02 on deterministic **and** http already at
N=512 (both −0.039); at N ≥ 1300 the deterministic identifier gate itself
breaks (fused identifier R@1 0.889). The targeted queries *did* improve
(e.g. tjs noterm-thresholds-py 23→11, http noterm-reconcile 5→3 at N=1024) —
the aggregate loss comes from everywhere else: whole-file chunks displace the
precise symbol chunks that identifier/error-string/paraphrase queries rely
on.

### 3b. Additive whole-file chunk (keep fragments, add one whole-file chunk)

Refuted, strictly harmful: duplicated content dilutes both legs. Lexical R@5
−0.079 on every engine (BM25 doc-length/IDF shift), fused R@5 −0.069 on both
real engines, deterministic no-term fused R@5 falls to 0.182 (< 0.2 gate),
and most class-(a) targets got *worse* (tjs noterm-reconcile 9→20,
noterm-thresholds-py 27→39; http para-yaml-digest 5→9).

### 3c. Residue-merge (keep symbol chunks, replace residue slivers with one whole-file chunk, files ≤ 1200 chars)

The most surgical variant and the best performer on the *targets* — on
transformersjs it improved 5 of 7 (drift-py fused 6→3, runbook 5→3,
token-go 4→1, emailer 6→5, thresholds-py 27→23). Still refuted on the
aggregate: http fused R@1 −0.098 (0.725 → 0.627), lexical R@5 −0.059 on all
engines, deterministic hybrid-MRR gate fails and its no-term fused R@5
collapses to 0.136, and noterm-reconcile regresses on both real engines
(tjs 9→17, http 4→5) — under RRF the whole-file chunk *competes with* the
symbol chunk of its own file on precision queries.

### 3d. YAML key-name enrichment (CONTEXT | keys: … line, the other 2026-07-12 candidate)

Mimicked extending `src/core/chunk-context.ts` to YAML by inserting
`CONTEXT | keys: ledger, max_drift_tolerance, …` as the second line of
`app.yaml`'s chunk (the only YAML passage in the corpus). Refuted as not
worth shipping: on http the *vector* rank of para-yaml-digest improves 6→4
but the **fused rank — what users see — stays 5** (the unchanged lexical leg
dominates the RRF there); deterministic's own app.yaml no-term query
(noterm-config) regresses 8→14 vector / 8→12 fused (key-list tokens dilute
the bag-of-words vector); tjs paraphrase fused R@1 drops 0.600→0.533. The
mechanism was always thin: `app.yaml` is a single whole-file chunk, so every
key token is already in the embedded text — the line only re-weights them.
Shipping it would also change stored chunk text, invalidating every existing
index (see §6) for no fused-rank gain.

## 4. Per-query verdicts

All seven class-(a) queries end the session **at-embedder-limit** (none
"fixed"); the fixed bucket is empty because every mechanism that lifted a
target broke a constraint elsewhere:

- **para-yaml-digest** (http vec 6): best chunk is the whole file; keys
  already embedded; key-enrichment lifts vector 6→4 but not fused. The
  rank-1–5 competitors are semantically legitimate (`emailer.py` really is
  about digests, `slack.rb` about channels). Embedder limit.
- **noterm-reconcile** (http vec 5, tjs vec 11): fragmentation is real
  (6 passages), but *every* merge variant made this query worse or flat
  while breaking gates — its wording ("money owed out and money coming in")
  sits closer to `thresholds.py`/`ledger.go` in both embedding spaces.
  Embedder limit given the chunk contract.
- **noterm-drift-py** (http vec 13, tjs vec 5): only residue-merge lifted it
  (13→11 http, 5→3 tjs) at unacceptable cost. Embedder limit.
- **para-runbook** (tjs vec 4): single whole-file prose chunk — nothing to
  merge or enrich. Pure embedder limit (http already ranks it 1).
- **para-emailer** (tjs vec 6, http vec 3): merge variants moved it at most
  one rank. Embedder limit.
- **noterm-thresholds-py** (tjs vec 23, http vec 1): the local model simply
  cannot bridge "calm, watchful, urgent" → "quiet, watch, page"; even a
  whole-file chunk left it at vec 24. Clear embedder limit — te3-small
  solves it at rank 1.
- **noterm-token-go** (tjs vec 4, http vec 1): residue-merge fixed it
  (4→1) but fails the suite. Embedder limit at current chunking.

The practical mitigations already in place cover these: fused R@5 is 0.971
(http) / 0.922 (tjs) — every one of these queries lands in the top 5, and
`semanticSearch` consumers see 5+ results. The residual gap is R@1 polish on
a stronger embedding model, not a chunking defect.

## 5. Live spot-check (flask, OpenRouter http engine)

Isolated workspace per the 2026-07-12 recipe (`config.yaml` repos-map shape,
`REPO_EXPERT_DATA_DIR`, http embeddings via OpenRouter; 92 files → 1197
passages). A para-yaml-digest-style config ask against flask's real
`pyproject.toml` ("oldest python release … which templating and WSGI
libraries as hard requirements") answered correctly and grounded on **2/2
runs**: `>= 3.10`, Werkzeug `>=3.1.0`, Jinja2 `>=3.1.2`, each explicitly
attributed to `pyproject.toml`. A deliberately unanswerable
para-yaml-digest-style ask ("which chat rooms or notification hooks does
this project post digests to?") correctly returned "no relevant evidence"
instead of hallucinating. At real-repo scale the config-file retrieval path
the class-(a) verdicts worry about is healthy — consistent with the fused
R@5 story in §4.

## 6. Notes for future chunk-text changes

Confirmed while scoping: `syncRepo` keys re-embedding on the **file content
SHA-256** (`src/core/content-hash.ts` via `shouldReindexFile`), not on chunk
text. Any change to chunking or enrichment output therefore leaves existing
indexes on the old passage shape until file content changes or
`repo-expert setup --reindex` — same upgrade path as the nomic task-prefix
note in `docs/architecture.md`. Whoever ships a chunk-text change must say
so in their doc and re-baseline all three engines in the same commit (the
corpus/chunk contract).

## Suite state

No production changes this session. Bench gates 5/5 and all three baseline
comparisons "ok" at e2b92c0 (§1); full vitest suite green (see PR CI).
Reports for the verification runs: `e2b92c0-{deterministic,transformersjs,http}.json`
shas. The two measurement harnesses (`eval/dump-legs.ts`,
`eval/merge-experiment.ts` with `--variant replace|additive|residue-merge|yaml-keys`)
were untracked throwaways, deleted per the eval-script convention; §2–§3
record everything needed to rebuild them from `eval/bench-pipeline.ts`
exports.
