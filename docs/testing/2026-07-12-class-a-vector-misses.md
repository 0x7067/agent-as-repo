# Class-(a) vector-leg misses: measured to the embedder's limit (2026-07-12)

Follow-up to `2026-07-12-retrieval-quality-fix.md` §3 "Left unfixed": the
queries where the vector leg itself never puts the gold file near the top, so
no fusion weighting can rescue them. Method as before — verify the baseline,
diagnose per query, change one thing per bench cycle. The outcome differs
from the last session: **every candidate mechanism was measured and none
ships.** Four chunking/ranking variants were benched; each either regresses a
committed baseline, trades one gold query for another 1:1, or duplicates
diversification the product already applies downstream of the measured leg.
The class-(a) set is at the embedder's limit on this (deliberately
cross-referential) corpus, with per-query evidence below.

## 0. Baseline re-verification (fresh container)

All three committed baselines reproduced exactly before any change:
deterministic fused R@1 0.333 / MRR 0.464 (5/5 gates), transformersjs
0.627 / 0.756, http 0.725 / 0.828. `Baseline comparison: ok` on all three.

## 1. Diagnosis: what actually sits above the gold

Per-query per-leg dumps (now a tracked tool: `eval/dump-legs.ts`, see §5)
over both real engines showed two mechanisms, in tension:

- **Fragment crowding.** Sub-1KB files chunk into 3–6 fragments (incl.
  109–200-char residue chunks). Wrong-file fragments occupy several top-k
  slots: for `noterm-reconcile` (http), `thresholds.py` fragments held 3 of
  the top 4 vector slots; the eval metrics do not dedupe files, so those
  slots are all lost.
- **Whole-file "hub" chunks.** `docs/runbook.md`, `docs/architecture-notes.md`,
  `config/app.yaml` are single mixed-topic chunks that rank top-5 for almost
  every ledger-ish query — topic-dense attractors that code files, competing
  as fragments, can't match.

## 2. Mechanisms measured (one bench cycle each)

### 2a. Coalesce small files into one whole-file chunk — REJECTED

`treeSitterStrategy` output replaced by a single whole-file chunk when the
file fits one chunk. At the full 2000-char budget this coalesced the entire
fixture corpus (78 → 22 passages) and **broke the identifier R@1 = 1.0
gate**: `id-ts-reconcile`'s focused `FUNCTION: reconcileLedgerBatch` chunk
disappeared, and `config/app.yaml` — whose comment literally names
`reconcileLedgerBatch` — took rank 1 on both legs. At a ~1KB threshold the
gate held but transformersjs regressed on exactly the headline metrics
(fused R@1 0.627 → 0.569, no-term R@1 0.455 → 0.364): per-query, 6 improved
and 11 worsened. The two representations serve different queries — focused
fragments win identifier/symbol-shaped queries, whole files win
topic-shaped ones — so replacement is structurally a trade, not a fix.

### 2b. Union: whole-file chunk *added* for small files — REJECTED

Same threshold, `[whole, ...fragments]` instead of replacement, so a file's
own best rank can only improve. Correct per file — but competitors gain
strong whole-file chunks too. transformersjs: 9 better / 9 worse, net fused
R@1 −1 query. http: **strictly worse on the class-(a) targets themselves**
(para-yaml-digest fused 5→7, noterm-reconcile 4→6, noterm-drift-py 9→10):
mid-size gold files (reconcile.ts, 1.1KB) get no whole-file chunk while
their small competitors do.

### 2c. Per-file result cap (diversification) — ALREADY SHIPPED, ELSEWHERE

Simulated caps of 1 and 2 passages per file over the raw legs. Per-query
file-rank is monotone non-decreasing under the cap, and it measured as such:
zero R@1 changes on either engine; http fused MRR +0.009 / R@5 +0.009 at
cap 1; ≈0 at cap 2. Then the audit found the product already does this
downstream: `archival_memory_search` over-fetches 2× and budgets with
`maxPerFile: 2` (`src/shell/agent-tools.ts`, `src/core/search-result-budget.ts`).
**The agent-visible ranking is already file-diverse; the bench measures the
raw fused leg upstream of that budget.** Duplicating the cap in the store
for a +0.009 bench delta would silently override a deliberate product
setting (2 per file, chosen for answer-synthesis context) — skipped.

### 2d. YAML per-top-level-section chunks — FIXES THE TARGET, ZERO-SUM — REJECTED

Direct cosine test (http): a `notify:`-section-only chunk of `app.yaml`
scores 0.400 against the para-yaml-digest query, beating every competitor
(best: emailer.py at 0.359), while the whole-file chunk (0.272) and a
prepended key-name context line (0.290) both lose. The doc's "prepend key
names" candidate is a near-no-op by construction — the keys are already in
the chunk text. Full 51-query simulation: `para-yaml-digest` fused **5 → 1**
… and `para-go-drain` fused **1 → 2**, because the new `queue:` section
chunk ("Upper bound on jobs pulled per DrainQueue pass") outranks
`worker.go` for its own paraphrase. Net fused R@1 exactly unchanged (0.725),
MRR +0.004. A real yaml section chunker (there is no tree-sitter yaml
grammar wired) is not worth a measured net-zero on a corpus whose files
deliberately describe each other.

## 3. Per-query verdicts (class-(a) set)

| query | engine(s) missing | vector rank (tjs / http) | verdict |
|---|---|---|---|
| para-yaml-digest | http | 1 / 6 | **at-embedder-limit** — fixable by yaml section chunks but strictly zero-sum (§2d); 5 distinct topical files above gold |
| noterm-reconcile | both | 11 / 5 | **at-embedder-limit** — thresholds.py (limit-classification) is a legitimate near-tie for a "blows past an allowed limit" query; fragment-crowding half is already handled by the product budget (§2c) |
| noterm-drift-py | both | 5 / 13 | **at-embedder-limit** — the query's discriminator is negation ("nothing about alarms or limits"), which embedding geometry cannot represent |
| para-runbook | tjs only | 4 / 1 | **engine-limit (tjs)** — http ranks it 1; fix is a stronger embedder, not chunking |
| para-emailer | both | 6 / 3 | **at-embedder-limit** — prose hubs that *describe* the emailer outrank it |
| noterm-thresholds-py | tjs only | 23 / 1 | **engine-limit (tjs)** — http ranks it 1 |
| noterm-token-go | tjs only | 4 / 1 | **engine-limit (tjs)** — http ranks it 1 |

Fixed: none (no change shipped — see §2 for why each candidate was
rejected). The tjs-only misses all resolve at rank 1 under
`text-embedding-3-small`; their practical fix is the configurable `http`
engine that already exists.

## 4. Live spot-check (flask, OpenRouter http engine)

Isolated workspace, fresh `--depth 1` clone, real `setup` path (bootstrap
29s). Two para-yaml-digest-style config paraphrases against flask's real
`pyproject.toml`, zero key names leaked in the questions:

- "oldest python interpreter this project promises to run on, and where is
  that promise recorded" → **Python 3.10, `pyproject.toml`
  `requires-python`** — correct, correctly attributed.
- "which templating library is a hard runtime requirement, and what minimum
  version" → **Jinja2 >= 3.1.2** — correct.

2/2. On a real corpus (~1.2k passages) config-paraphrase retrieval works;
the mini-corpus failures come from its adversarial cross-referencing (every
file names its siblings' behavior), which is what makes it a useful gold
set and a poor predictor of absolute production quality.

## 5. What ships

- **`eval/dump-legs.ts` (tracked).** The per-query diagnosis tool this and
  the previous session each had to rebuild. Same `indexCorpus`/`searchLegs`
  pipeline as the bench; prints per-leg rankings with gold markers and the
  gold files' chunk inventory. Engine-selectable like `bench.ts`.
- **`fix(lint)` commit (37aec64)** — 15 pre-existing lint errors that were
  failing CI on main itself (introduced by PR #25's merge), fixed here and
  also pushed to the open PR #26 branch so its `verify` check can go green.
  Two of the mechanical fixes hid real bugs and were done differently:
  `interactiveInputAvailable` keeps its `=== true` (runtime `isTTY` is
  `undefined` on pipes and would re-enable prompts via init.ts's
  `allowPrompts = true` default), and `checkStateConsistency` invokes
  `agentExists` through the provider (the port claims `this: void` but
  `LocalProvider` reads `this.store`).

## 6. Notes for future chunking work

- `shouldReindexFile` hashes **file content only** — there is no
  chunker-version salt. Any future change to chunk *shape* (coalescing,
  yaml sections, header format) silently leaves stale passages in existing
  stores for unchanged files; it must ship with either a chunker-version
  field in the hash input or a documented `setup --reindex` requirement.
  Moot this session (no chunk change shipped), load-bearing for the next.
- The bench measures the raw fused leg; the agent-visible ranking applies
  `budgetSearchResults` (per-file cap 2) on a 2× over-fetch. If class-(a)
  work resumes, consider benching the *budgeted* view too — the raw-leg
  numbers understate production diversity.

## Suite state

1451 passed / 1 skipped (`node_modules/.bin/vitest run`), lint and
typecheck clean, deterministic gates 5/5, all three baseline comparisons
`ok` (baselines untouched — nothing shipped that moves retrieval numbers).
