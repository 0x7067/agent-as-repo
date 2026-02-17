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
- Letta SDK `passages.create` returns `Array<Passage>` (not single object) — both `letta-provider.ts` and `mcp-server.ts` are correct
- `Config.defaults.tools` was declared but never populated — removed from type since per-repo tools with fallback to `userDefaults.tools` covers all cases
- `watch.ts` poll loop: abort handler is the sole resolve path; interval callback just clears itself
- `execFileSync` (no shell) vs `execSync` (uses `/bin/sh -c`) — this codebase should always use the former
