# Follow-up plan: transformers.js testing + fixes for E2E findings

Companion to `2026-07-11-e2e-openrouter-findings.md`. Environment change coming:
**huggingface.co egress will be allowed**, unblocking the `transformersjs`
embedding engine. The next session should (A) fully test that path, and
(B) fix all findings from the E2E exercise, TDD-style per CLAUDE.md.

## A. transformers.js test plan (blocked until HF egress is enabled)

Everything below previously failed at the model download (CONNECT 403 to
huggingface.co). With egress enabled, exercise in an isolated workspace
(`config.yaml` with `embedding_engine: transformersjs`, OpenRouter chat):

1. **Cold start**: `setup` with empty HF cache — verify the ~140 MB ONNX download
   succeeds, passages load (expect `570/570` style success, not the silent-failure
   mode from the findings doc), and note first-run wall time.
2. **Warm cache**: wipe the store (not the cache), re-setup — verify no re-download
   and materially faster indexing.
3. **Offline after warm-up**: confirm embeddings work with no network (the README
   claims fully-offline operation post-download).
4. **Nomic prefix handling**: default model `nomic-ai/nomic-embed-text-v1.5` —
   verify passages get `search_document:` and queries get `search_query:` prefixes
   (README documents this), e.g. via a retrieval A/B on a paraphrase query.
5. **Retrieval-quality comparison**: run the same commit-canary + grounded-ask
   battery from the E2E exercise on 1–2 repos and compare against the
   `openai/text-embedding-3-small` results; also re-run `eval/bench.ts` if it can
   target the transformersjs engine.
6. **Engine-switch reindex**: switch an existing http-embedded workspace to
   transformersjs and confirm the dimension/vector-space mismatch is surfaced and
   `setup --reindex` recovers (watch out for finding B2 — reindex duplication —
   which corrupts exactly this flow today).
7. **MCP path**: `LLM_EMBEDDING_ENGINE=transformersjs` on the MCP server,
   re-run the 8-tool exercise (search/insert/delete are the embedding-sensitive ones).

## B. Fix list (ranked; each needs a failing test first)

### High

1. **Silent >50 KB file exclusion** — `MAX_FILE_SIZE_KB` (`src/core/types.ts`),
   enforced in `src/shell/file-collector.ts` and `src/shell/repo-tools.ts`
   (`handleReadFile`). Minimum: `setup`/`sync` print "N files skipped (> 50 KB):
   <paths>". Preferred: index large files anyway (chunking already caps chunk
   size); raise or remove the read cap, or read windows on demand.
   Repro: sinatra's `lib/sinatra/base.rb` (67 KB) → zero passages, unreadable.
2. **`setup --reindex` duplicates passages / leaks stale scope** — reindex must
   purge the agent's existing passages (or diff against them) before loading.
   Repro: 652-passage index + `base_path: lib` + `--reindex` → 676 rows in
   `passages` (nothing purged); out-of-scope content still answerable.
3. **State-file/store drift** — `setup` trusts `.repo-expert-state.json` even when
   the store lacks the agent:
   - `setup` should verify the agent exists in the store (`agents` table) and
     re-run `initAgent` when missing (self-heal), instead of "already exists,
     skipping".
   - `reconcile`/`doctor` should detect a state-file agent with no `agents` row.
   - Total chunk-load failure ("N/N chunks failed to load") must fail setup
     (non-zero exit, no "Setup complete", skip bootstrap).
   Repro: `setup`, delete the data dir, `setup` again → "skipping", exit 0,
   empty store; MCP `agent_list` returns `[]`, all tools 404.
4. **Hallucination on absent features / ungrounded bootstrap** —
   - Persona/system prompt: add an explicit rule for negative-space questions
     ("if archival search returns no supporting passages, state the feature does
     not exist in this repo; never describe unverified internals").
   - Bootstrap + `onboard`: file lists must be validated against the actual index
     (drop paths with zero passages; no `path/to/` template prefixes).
   Repros: gin "built-in rate limiter" fabricated; express `lib/router/index.js`
   fabricated; flask `--fast` invented `flask create`; gin architecture block
   claims nonexistent `/tests`, `/middleware` dirs; flask onboard prints literal
   `path/to/...` on all Top-10 entries.

### Medium

5. **Embedding preflight false-fail** — replace the `GET /models` lookup with a
   real `POST /embeddings` probe (tiny input); make the hint endpoint-aware
   (only suggest `ollama pull` for local Ollama base URLs). Affects `doctor`
   (exit 1 on healthy system) and forces `--skip-preflight` on every setup.
6. **`sync` never sets `lastSyncAt`** — stamp it in the sync path
   (`src/shell/sync.ts` / the `sync` action in `src/cli.ts`) exactly as
   `src/shell/watch.ts:44` does; unbricks the `lastSyncAt` branch in
   `src/core/git-evidence.ts` and fixes the `status` contradiction
   (`last sync: <hash>` + `last sync at: never`).
7. **`init` silent failure on piped stdin** — non-TTY stdin should either error
   clearly ("stdin is not a TTY — use `--yes --repo-path ...`") or support batch
   input; today the swallowed readline rejection exits 0 having written nothing.
   Also widen `EXCLUDED_EXTENSIONS` in `src/core/init.ts` (`.pbxproj`,
   `.xcworkspacedata`, `.resolved`, `.sample`).
8. **`mcp-install --local` / `mcp-check` mismatch** — `mcp-check` must also look
   at `./.claude.json` (mirror the `--local` flag). Add `.claude.json` to
   `.gitignore` guidance or warn on install that the file contains the API key
   in plaintext.

### Low / UX

9. Unify repo targeting: accept positional `<repo>` on `export`/`destroy` (or
   `--repo` on `ask`/`onboard`) — commander arity errors tripped multiple testers.
10. `list` "files" vs setup "Found N files": label the metric ("files with
    passages") or report skipped/empty files.
11. `consolidate`: report whether blocks changed and stamp "last consolidated at"
    in state/`status`.
12. Spinner: suppress animation when stdout is not a TTY. `export`: add
    `--output <file>`. `ask`: add a `--verbose`/debug flag showing retrieved
    passages (currently requires sqlite spelunking to audit grounding).
13. Retrieval quality on paraphrase/no-term queries (bench Recall@1 = 0.0 for
    both kinds) — worth a dedicated pass once transformersjs comparison data from
    section A exists; the nomic asymmetric prefixes may move this.
14. Docs/dev-env: note in CONTRIBUTING that pnpm 10 (`node-linker=hoisted`) may
    leave/wipe better-sqlite3's native addon (`pnpm run` re-links node_modules);
    `self-check` could suggest the `cd node_modules/better-sqlite3 && npx node-gyp
    rebuild --release` recovery.

## Suggested order for the fix session

Red-green per item: 3 (data integrity + trust), 2, 1, 5, 6, 4 (prompt +
grounding), 7, 8, then the low tier. Items 1–3 have direct sqlite-verifiable
assertions and existing repro workspaces under `/home/user/test-workspaces/`
(ephemeral — recreate from the repro commands above if the container is gone).

## Results (follow-up session, same day)

### A. transformers.js — all 7 matrix items exercised

HF egress was still blocked at session start (proxy CONNECT 403 to
huggingface.co and CDN hosts) but opened mid-session. One environment
gotcha to know: Node's built-in `fetch` (used by `@huggingface/transformers`)
does **not** honor `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is set
(Node ≥ 22.21) — without it the download fails even when the proxy allows
HF, and (pre-fix) that network failure looked like a successful setup.

1. **Cold start: PASS.** ~132 MB total (137 MB quantized ONNX + tokenizer),
   cached under `node_modules/@huggingface/transformers/.cache/`. flask:
   1014/1014 chunks loaded. Download itself ~4 s.
2. **Warm cache: PASS with caveat.** No re-download, but indexing wall time
   is unchanged (~265 s for ~1000 chunks): CPU-bound q8 ONNX inference
   dominates; the download was never the bottleneck. For comparison, the
   same corpus indexes in ~2.2 s via OpenRouter `text-embedding-3-small`
   (~120x faster).
3. **Offline after warm-up: PASS.** With all proxy env stripped, `sync`
   (1 changed file, 2.2 s) and semantic search both work fully offline.
4. **Nomic prefixes: VERIFIED** in code (`embedding-prefix.ts` →
   `embedder-factory.ts` applies `search_document:` on writes at
   `sqlite-store.ts` and `search_query:` on searches) and behaviorally
   (paraphrase query with zero term overlap retrieved the canary as #1).
5. **Retrieval A/B: parity.** flask + sinatra, 3 grounded + 1 adversarial +
   5x commit-canary per engine: transformersjs 3/3, honest, 5/5 + 4/5;
   http/text-embedding-3-small identical (4/5 on the same sinatra canary).
   `eval/bench.ts --engine transformersjs` vs the deterministic-stub
   baseline: fused Recall@1 0.619→0.714, paraphrase 0.0→0.2, no-term
   0.0→0.5, fused MRR 0.698→0.810 (bench has no `--engine http` mode, so
   stub-vs-transformersjs is the only tool-level comparison).
6. **Engine-switch reindex: two new bugs found**, both fixed this session —
   without `--reindex` the mismatch is a silent "skip" and every search
   errors (and pre-fix, the model then answered from pretrained knowledge);
   `--reindex` was a complete no-op (all writes failed the dimension guard
   while setup reported success, invisibly in `--json`). Post-fix the purge
   resets the stored dimension and the flow recovers; total failure exits 1.
7. **MCP with `LLM_EMBEDDING_ENGINE=transformersjs`: 8/8 tools PASS**
   including insert→search→delete round-trip and unknown-agent error path.

### B. Fix list — all items fixed except 13 (deferred, data-informed)

Every item landed TDD red-green on `claude/repo-experts-e2e-followup-n3y8yd`
(see the Outcomes table appended to the findings doc for the per-item
detail, commits, and live-repro verification verdicts — findings 1–8 were
each re-verified against their original repro with OpenRouter, including
13/13-honest repeated adversarial probes across gin/express/flask for
item 4). Item 13 (paraphrase/no-term retrieval) is deferred: the A/B above
gives the first real signal (real embeddings already move it materially);
an algorithm change should be designed against those numbers.

Final state: 1381 tests passed / 1 skipped, typecheck clean, bench gates
pass. Note for future sessions: `.repo-expert-state.json` resolves relative
to CWD (not `REPO_EXPERT_DATA_DIR`), so isolated experiments need their own
CWD, and agent worktrees created from a session snapshot may base on the
default branch — check `git merge-base` before assuming a worktree includes
branch work.
