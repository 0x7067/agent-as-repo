# E2E exercise: repo-expert × OpenRouter × 7 real repos (2026-07-11)

Full exercise of the CLI (all subcommands), the MCP server (all 8 tools), and the
retrieval bench against real codebases, with OpenRouter as the LLM backend
(`openai/gpt-4o-mini` chat, `openai/text-embedding-3-small` embeddings,
`embedding_engine: http`). Each repo ran in an isolated workspace
(own `config.yaml`, own `REPO_EXPERT_DATA_DIR`).

**Repos exercised**

| Repo | Kind | Language(s) | Files → passages | Setup (index / bootstrap) |
|---|---|---|---|---|
| claude-hashline | own | TypeScript | 72 → 570 | 2.3s / 20.7s |
| cc-translate-proxy | own | Python | 49 → 519 | 2.0s / 26.8s |
| ConwayGame | own | Swift (iOS + SPM + Vapor) | 85 → 1256 | 3.1s / 31.1s |
| expressjs/express | OSS | JavaScript | 145 → 439 | 2.1s / 31.7s |
| pallets/flask | OSS | Python | 90 → 1012 | 2.2s / 23.6s |
| gin-gonic/gin | OSS | Go | 106 → 1956 | 3.7s / 26.0s |
| sinatra/sinatra | OSS | Ruby (3 subprojects) | 162 → 650 | 1.9s / 21.7s |

Zero OpenRouter API errors, rate limits, or crashes across ~70 LLM-backed calls.

## What works well

- **Full pipeline** (`setup` → index → bootstrap → `ask`) succeeded on all 7 repos.
  Indexing is fast (1.9–3.7s, up to ~1950 passages); the LLM bootstrap dominates
  setup wall time (20–32s).
- **Tree-sitter chunking** produced clean symbol-level chunks (`CLASS:`/`METHOD:`/
  `FUNCTION:`/`MODULE:` labels) with no warnings across TS/JS, Python, Go, Ruby,
  and Swift.
- **Incremental sync + retrieval**: the injected-content canary (new committed file
  with a distinctly named function) was retrieved **5/5 accurately on all 6 repos
  tested** — correct file path and near-verbatim code. `sync` diffs are fast
  (1.2–3.1s); no-op sync correctly reports "no changes".
- **`watch`** detected a new commit within one 5s poll cycle and auto-synced.
- **Multi-repo workspace**: two agents in one store, `ask --all` broadcast, per-repo
  `persona` — all fine.
- **MCP server**: all 8 tools pass over stdio, including insert→search→delete and
  update-block→verify→restore round-trips; clean `isError` on unknown agents; no
  stdout protocol corruption; `tools/list` matches `docs/mcp-setup.md` 1:1.
- **`init`**: fully non-interactive via flags (`--yes --repo-path --model
  --base-url --embedding-engine`) — verified working; recommended for automation.
- **Bench + unit suite**: `eval/bench.ts` deterministic gates all pass; vitest
  1247 passed / 1 skipped when run directly (see infra note below).
- Read-only commands (`list`, `status`, `reconcile`, `config lint`,
  `destroy --dry-run`, `export`, `self-check`, `completion`) are all sub-second and
  behaved safely (`destroy --dry-run` verified non-destructive everywhere).

## Bugs, ranked

### High

1. **Files > 50 KB are silently excluded from both indexing and `read_file`.**
   `MAX_FILE_SIZE_KB = 50` (`src/core/types.ts`) is enforced in
   `src/shell/file-collector.ts` and again in `src/shell/repo-tools.ts`
   (`handleReadFile`). On sinatra this excludes `lib/sinatra/base.rb` (67 KB) — the
   single most important file — with **no warning**. Asked "how are routes defined
   in base.rb?", the agent could neither search nor read it (2/5 answer).
   Since chunking already splits at ~2 KB, a whole-file pre-gate mostly filters out
   the largest, most-asked-about files. Fix: warn "N files skipped (size)" at
   minimum; better, chunk large files anyway.

2. **`setup --reindex` duplicates passages instead of replacing them; stale
   out-of-scope passages stay searchable.** From a clean 652-passage sinatra index:
   add `base_path: lib` + `--reindex` → store holds 676 rows (652 old + 24 new);
   revert + `--reindex` again → 1328 rows. While scoped to `lib`, asks about
   `rack-protection` (excluded) still answered from orphaned passages.
   `reconcile` detects the orphans and `reconcile --fix` cleans them, but nothing
   tells the user reindex created drift.

3. **State-file ↔ store drift bricks the MCP path with no repair.** `setup` trusts
   `.repo-expert-state.json` over the actual store: if `store.db` is wiped (or
   `REPO_EXPERT_DATA_DIR` changes), `setup` says "already exists, skipping" and
   writes nothing — reporting "Setup complete". After `reconcile --fix` + `setup`,
   passages come back but the `agents` registry row is **never recreated**, so every
   MCP tool returns `agent not found` (all gate on `assertAgentExists`, which reads
   only the `agents` table) while the CLI keeps working. `doctor` reports "State
   consistency: State matches config" throughout. Only `destroy` + fresh `setup`
   recovers. Related: on a total indexing failure ("570/570 chunks failed to load",
   seen when the embedding backend was unreachable), setup still bootstraps, prints
   "Setup complete", and exits 0.

4. **Hallucination on absent features / weakly grounded answers is inconsistent.**
   - gin: asked about a (nonexistent) built-in rate limiter → confidently fabricated
     one, citing the real `ClientIP()` helper. Express/flask/sinatra adversarial
     probes passed cleanly, so honesty is model-luck, not enforced by the persona.
   - express: fabricated `lib/router/index.js` internals (express 5 delegates to the
     external `router` package; the file doesn't exist).
   - `--fast` fabricated a `flask create` CLI command.
   - Bootstrap memory blocks can bake in hallucinations (gin's architecture block
     claims `/tests` and `/middleware` dirs that don't exist) which then propagate
     verbatim into `onboard`.
   Suggested: strengthen persona instructions for negative-space questions ("if
   archival search returns no evidence, say the feature doesn't exist"), and ground
   bootstrap/onboard file lists against the actual index.

### Medium

5. **Embedding-model preflight false-fails against OpenRouter** (embedding models
   aren't in `GET /models`), forcing `--skip-preflight` on every setup, making
   `doctor` exit 1 on a fully healthy system (breaks automation gating on it), and
   printing an Ollama-specific hint ("try: ollama pull openai/text-embedding-3-small")
   regardless of endpoint. Fix: probe `POST /embeddings` with a tiny input instead
   of consulting the model list.

6. **`sync` never sets `lastSyncAt`** (`src/shell/sync.ts` omits it; only
   `src/shell/watch.ts:44` sets it), so `status` permanently shows
   `last sync: <commit-hash>` next to `last sync at: never`, and the
   `lastSyncAt` branch in `src/core/git-evidence.ts` is dead for CLI-sync users.
   Found independently by 5 of 6 repo exercises.

7. **`init` with piped (non-TTY) stdin exits 0 silently, writing nothing.**
   Two prompts consume buffered lines, stdin EOF closes readline, the third
   `rl.question` rejects, and the error is swallowed. Expected: a clear "stdin is
   not a TTY — use flags" error. (Interactive via pty and flag-based init both work.)

8. **`mcp-install --local` / `mcp-check` mismatch + plaintext key.** `mcp-install
   --local` writes `./.claude.json`, but `mcp-check` only ever reads
   `~/.claude.json`, so a local install can never validate. Also, `mcp-install`
   copies `LLM_API_KEY` in plaintext into `.claude.json` — a local one is easy to
   commit accidentally (it isn't in `.gitignore`).

### Low / UX

9. **Positional-vs-`--repo` inconsistency**: `ask <repo>` / `onboard <repo>` vs
   `export --repo` / `destroy --repo`; `destroy sinatra --dry-run` fails with a
   commander arity error. Multiple agents tripped on it.
10. **`onboard` artifacts**: literal `path/to/` prefix on every "Top 10 files" entry
    (flask); nonexistent/wrong paths recommended (sinatra), including a file that
    has zero indexed passages due to bug 1.
11. **`list` "files" counts files-with-passages** while setup reports files found
    (87 vs 90 on flask) — same label, different metric; can mask indexing gaps.
12. **`consolidate` gives no signal whether anything changed** (byte-identical
    blocks after a 20s LLM call look the same as a silent no-op); no
    "last consolidated at" in `status`.
13. **Spinner floods non-TTY output** (hundreds of frames in piped logs);
    `export` has no `--output`; `ask` has no `--verbose` to show retrieved passages
    (needed sqlite spelunking to debug retrieval).
14. **Retrieval quality on paraphrase queries is the weak spot**, matching the
    bench (fused Recall@1: identifier 1.0, paraphrase 0.0, no-term 0.0). Observed
    live: a note synced by `watch` was in the store and FTS-rankable, yet the agent
    misattributed it to a different file two runs in a row.

## Infra notes (this sandbox, not product bugs)

- `embedding_engine: transformersjs` is unusable when huggingface.co is blocked
  (egress 403) — which produced the "570/570 chunks failed / Setup complete" case
  in bug 3. OpenRouter's `/embeddings` endpoint works and is a good remote pairing.
- pnpm 10 + `node-linker=hoisted` here: fresh `pnpm install` left better-sqlite3's
  native addon unbuilt, and any `pnpm run …` re-link wipes a manually built one →
  52 test failures that disappear entirely when running `node_modules/.bin/vitest
  run` directly (1247 pass / 1 skip). Worth a note in CONTRIBUTING or a self-check
  hint (`self-check` did correctly diagnose the addon when present).

## Method

Seven isolated exercises ran in parallel (one subagent per repo + one for the MCP
server), each: `config lint` → `doctor` → `setup` → `list`/`status` → 3 grounded
asks verified against source + 1 adversarial ask + `--fast` → commit-canary `sync`
→ retrieval check → `reconcile` → `consolidate` → `export` → `onboard` →
`destroy --dry-run`. Grounding was verified by reading the target repos' actual
source; store contents were verified by direct sqlite queries where needed.
