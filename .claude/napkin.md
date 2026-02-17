# Napkin

## Corrections
| Date | Source | What Went Wrong | What To Do Instead |
|------|--------|----------------|-------------------|
| 2026-02-16 | self | Assumed `execSync` was safe because CLI is local-only | Always use `execFileSync` with array args when interpolating any variable into a command — even CLI tools can have injection vectors |
| 2026-02-16 | self | Missed that chunker's `" (continued)"` suffix leaks into export file extraction | When parsing structured text headers, account for all variants the producer can emit |
| 2026-02-16 | self | `Promise.race` with `setTimeout` — forgot the timer keeps running after race resolves | Always store timeout ID and clear in `finally` when using `Promise.race` with timers |
| 2026-02-16 | self | `gitDiffFiles` swallowed errors as empty array `[]`, causing silent state advancement | Distinguish "no results" from "operation failed" — use `null` for errors, `[]` for empty |
| 2026-02-16 | audit | Incremental sync skipped config filters (extensions, ignoreDirs) that initial setup applies | Any path that produces a file list must apply the same filters as the canonical `collectFiles` |
| 2026-02-16 | audit | `mcp-server.ts` ran `main()` at import time, breaking test imports | Guard entry points: `if (process.argv[1] === fileURLToPath(import.meta.url))` |
| 2026-02-17 | self | Started repository exploration before reading `.claude/napkin.md` | Read napkin first at session start, then begin codebase/tool work |
| 2026-02-17 | self | CLI integration tests tried to execute `src/cli.ts` relative to temp CWD, causing module-not-found failures | Use an absolute entry path when spawning CLI processes from temp directories |
| 2026-02-17 | self | `rg` pattern beginning with `--` was parsed as command flags and broke a verification grep | Use `rg -n -- \"pattern\" file` when the search pattern may begin with hyphens |
| 2026-02-17 | self | Assumed init always writes `.env`; tests failed when `LETTA_API_KEY` was inherited from parent env | In integration tests, control env explicitly (`LETTA_API_KEY=\"\"`) when asserting `.env` creation |
| 2026-02-17 | self | `sync --dry-run --full` still required git HEAD, causing unnecessary failures on non-git fixtures | For dry-run planning paths, relax git HEAD requirements when no write/network actions depend on it |
| 2026-02-17 | self | Used `Date.now()`-only temp names for atomic state writes; concurrent saves collided and caused `ENOENT` on rename | Include a uniqueness suffix (e.g., `randomUUID()`) in temp file paths used for atomic writes |
| 2026-02-17 | self | Tried `vi.spyOn` on ESM namespace export (`fs.promises.rename`) and hit non-configurable export errors | Add explicit test injection hooks for filesystem edges instead of spying on ESM namespace exports |
| 2026-02-17 | self | Wrote build script with top-level `await`; `tsx` executed it as CJS and failed at runtime | Wrap build scripts in `main()` and call it explicitly for CJS/ESM compatibility |
| 2026-02-17 | self | Ran full `pnpm test` in sandbox and got noisy `tsx` IPC `EPERM` failures from CLI integration tests | Run targeted vitest suites for changed units in sandbox; treat CLI spawn tests as environment-limited unless unsandboxed |
| 2026-02-17 | self | Used a hoisted `vi.mock()` factory that referenced a top-level variable (`mockWatch`) before initialization | In Vitest, keep `vi.mock()` factories self-contained; do not capture top-level variables from test scope |
| 2026-02-17 | self | Daemon kept logging `401 Unauthorized` while manual CLI checks passed | Compare shell `LETTA_API_KEY` with `.env` key; launchd may use a different environment than your shell and can run with stale credentials |
| 2026-02-17 | self | After fixing daemon credentials, watch kept retrying the same repo until one successful sync advanced `lastSyncCommit` | For persistent sync failures, run a one-off `repo-expert sync --repo <name>` to unblock watch loop and clear repeated errors |
| 2026-02-17 | self | Ignored watch-file filter failed because `fs.watch` can emit absolute paths (not only repo-relative names) | For watcher ignore rules, compare both normalized absolute paths and normalized repo-relative paths |

## User Preferences
- Use `/platform-cli` skill for CLI design
- No `any` or `as any` — proper types, `unknown` with narrowing
- Use `consult-codex` skill for dual-AI audit/analysis
- Use `promptify` skill to refine prompts before executing complex tasks
- Conventional commits, subject < 72 chars, imperative mood

## Patterns That Work
- Dual-AI audit (Claude + Codex in parallel) catches issues neither finds alone — Codex found incremental sync filter drift and silent state corruption
- Running all tests after batch edits catches regressions immediately — 135 existing + 3 new = 138 green
- `shouldIncludeFile(path, 0, config)` — passing 0 for size skips the size check while still filtering by extension and ignoreDirs

## Patterns That Don't Work
- `execSync` with template literals — always use `execFileSync` with arg arrays
- Returning `[]` from functions that can fail — callers can't distinguish empty from error
- `Promise.race` with bare `setTimeout` — leaks timers; always track and clear

## Domain Notes
- Letta Folders API: `embedding_chunk_size` blocked on cloud API (400 error) — can't tune chunk size
- Letta Folders API pagination: `folders.files.list()` uses `.items` (ArrayPage), `agents.files.list()` uses `.files` (NextFilesPage) — NOT `.data`
- Letta Folders API: files namespaced under folder name (`my-folder/src/file.ts`), not bare paths
- Letta SDK `passages.create` returns `Array<Passage>` (not single object) — both `letta-provider.ts` and `mcp-server.ts` are correct
- `Config.defaults.tools` was declared but never populated — removed from type since per-repo tools with fallback to `userDefaults.tools` covers all cases
- `watch.ts` poll loop: abort handler is the sole resolve path; interval callback just clears itself
- `execFileSync` (no shell) vs `execSync` (uses `/bin/sh -c`) — this codebase should always use the former
- `ask --all` timeout default is shared by CLI and broadcast helper; keep both wired to `BROADCAST_ASK_DEFAULT_TIMEOUT_MS` in `src/shell/group-provider.ts`
- Single-agent ask default should be sourced from `ASK_DEFAULT_TIMEOUT_MS` in `src/core/ask-routing.ts`; wire config built-ins to the same constants to avoid drift
