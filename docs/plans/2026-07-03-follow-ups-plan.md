# Follow-Ups Plan — After the Single-Provider Convergence

Date: 2026-07-03
Status: proposed
Depends on: `2026-07-03-single-provider-plan.md` (landed on `claude/repo-experts-agent-path-uqmmnt`)

Four items, in two groups: two small behavior gaps the convergence introduced, and two larger deferred work items. Ordered by effort; items 1–2 are quick wins, items 3–4 are separate efforts that each deserve their own branch.

## 1. Restore `ask --fast` via `provider.fast_model` (small)

**Today:** `ask --fast` is a silent no-op unless `--fast-model <id>` is also passed. The old behavior read `fastModel` from the Letta provider config, which was deleted with the union.

**Change:**
- Add optional `fast_model` (string) to the provider config schema (`src/core/config.ts`, `ProviderConfig.fastModel?` in `src/core/types.ts`). No default.
- `ask --fast` resolves the override model as: `--fast-model` flag → `provider.fast_model` → error `"--fast requires provider.fast_model in config.yaml or --fast-model"`. Erroring beats the current silent no-op — a flag that does nothing is a bug users can't see.
- Update `config.example.yaml` (commented `fast_model:` line with an Ollama example, e.g. a small instruct model) and the README env/config section.

**Tests (TDD):** config parse accepts/omits `fast_model`; CLI resolution precedence; error path when `--fast` has no model source.

## 2. `doctor --strict` for the LLM-endpoint check (small)

**Today:** `doctor` only warns when the LLM endpoint (`GET {base_url}/models`) is unreachable, so a stopped Ollama doesn't fail the run. That is the right default (doctor is often run before starting services), but CI/scripted use has no way to demand a fully healthy stack.

**Change:**
- Add `--strict` to `doctor`: warnings (LLM endpoint unreachable, missing optional keys) are promoted to failures and the exit code is non-zero.
- Keep the check-result model as-is — `runAllChecks` already distinguishes warn/fail levels; `--strict` is a presentation/exit-code concern in `src/cli.ts` + `src/core/doctor.ts` formatting.
- Document both behaviors in the README command table.

**Tests:** warn stays exit-0 without the flag; same result set exits non-zero with `--strict`.

## 3. Replace OpenViking with an embedded sqlite-vec store (large)

**Why:** OpenViking is the last external server besides Ollama, and the riskiest dependency (pre-1.0, AGPL-3.0, frequent breaking releases — see the convergence plan's accepted-risk note). It contributes exactly two things to this codebase: passage storage and semantic search (`viking-http.ts` uses only fs mkdir/upload/read/delete/ls + `POST /api/v1/search/find`). Both are replaceable by an in-process store, which would make the entire stack two processes: the CLI and Ollama.

**Target design:**
- **New port** `src/ports/passage-store.ts` — the narrow surface `viking-provider.ts` actually consumes from `VikingHttpClient`: `initAgent`, `deleteAgent`, `writePassage`, `readPassage`, `deletePassage`, `listPassages`, `semanticSearch(agentId, query, limit)`. Extract it first and make `VikingHttpClient` (via a thin adapter) satisfy it — behavior-preserving refactor, suite stays green.
- **New impl** `src/shell/sqlite-store.ts`: sqlite-vec (`sqlite-vec-darwin-arm64` prebuilds + better-sqlite3) with one DB file per machine at `~/.repo-expert/store.db`. Schema: `passages(id, agent_id, file_path, text, created_at)` + a `vec0` virtual table for embeddings; per-file resync becomes `DELETE ... WHERE agent_id = ? AND file_path = ?` — strictly better than today's ID-list bookkeeping, but keep writing passage IDs to `.repo-expert-state.json` so `reconcile` and state semantics are unchanged.
- **Embeddings**: new `embed(texts: string[])` in `src/shell/llm-client.ts` calling `POST {base_url}/embeddings` (OpenAI-compatible; Ollama serves it). Config: `provider.embedding_model` (default `nomic-embed-text`). This moves embedding ownership from OpenViking's out-of-band `ov.conf` into `config.yaml` — a UX win worth calling out in docs.
- **Search**: cosine top-k via sqlite-vec `MATCH`, returning the same `{uri/abstract/score}`-shaped results the agent loop's `archival_memory_search` tool expects.
- **Blocks**: `FilesystemBlockStorage` moves from `~/.openviking/blocks/` to `~/.repo-expert/blocks/` (or a `blocks` table in the same DB — decide during implementation; table preferred, one storage substrate).

**Migration stance:** same as the convergence — this *replaces* OpenViking, it does not become a second configurable backend. During the work, both implementations exist behind `PassageStore` only so the suite stays green commit-by-commit; the final commit deletes `viking-http.ts`, `openviking-paths.ts`, the `viking_url` config key, and `VIKING_API_KEY`. Existing agents re-index with `setup --reindex` (embeddings must be regenerated anyway). Re-evaluate the `viking-` naming (`viking-provider.ts` → `local-provider.ts` or `repo-agent-provider.ts`) in the final rename commit.

**New risk to accept:** sqlite-vec is pre-1.0 (`0.1.x`) and better-sqlite3 is a native dep — verify SEA bundling still works (the convergence deliberately kept the bundle free of native addons; this breaks that property and needs a spike *first*: can the SEA binary load a native module, or does the store need to ship as a `.node` file next to the binary?). This spike is the go/no-go gate for the whole item.

**Phases:** (1) SEA + native-addon spike → go/no-go; (2) extract `PassageStore` port, adapter over `VikingHttpClient`; (3) `embed()` in llm-client; (4) `sqlite-store.ts` + parametrized contract tests run against both store impls (the contract-test suite the two-provider era never had); (5) swap default, delete OpenViking code + config + docs.

## 4. Summarize-on-sync memory consolidation (medium)

**Why:** Letta's `enableSleeptime` (background memory consolidation) was dropped as a no-op. Its value — the agent's `architecture`/`conventions` blocks improving over time instead of staying frozen at bootstrap — is worth recreating in a simpler, synchronous form.

**Target design:**
- **Core (pure):** `src/core/consolidate.ts` — `buildConsolidationPrompt(blocks, changedFiles, diffSummary)` returning the LLM messages, and `shouldConsolidate(plan, config)` deciding when (e.g. only when a sync touched ≥ N files or a threshold of passages changed; thresholds in config). Colocated tests, no mocks.
- **Shell:** `src/shell/consolidate.ts` — after a successful `syncRepo`, run one `toolCallingLoop` turn with only the `memory_replace` tool exposed, seeded by the consolidation prompt; the model rewrites the `architecture`/`conventions` blocks (persona is never touched). Reuses `llm-client.ts` and `BlockStorage` as-is — no port changes.
- **Surface:** `defaults.consolidate_on_sync: false` (opt-in) in config, plus an explicit `repo-expert consolidate [--repo]` command for manual runs. `watch` inherits the config flag for free since it calls sync.
- **Safety:** cap block size at the existing block limit; if the model returns nothing usable, keep the old blocks and log — consolidation must never make memory worse or fail the sync.

**Tests:** prompt-building and gating in core (pure); shell test with mocked llm-client asserting blocks are updated on success and untouched on failure; CLI test for the new command.

## Sequencing

1 and 2 can land together as one small PR on top of the convergence branch. 4 is independent of 3 (it only touches llm-client + blocks) and can start any time. 3 starts with its spike; do not begin phase 2+ until the SEA question is answered. If 3 lands, revisit 4's block storage to use the same DB.
