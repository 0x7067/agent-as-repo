# Project State
updated: 2026-07-09

## Goal
repo-expert is a local-first CLI + MCP server that keeps semantic memory for
git repos and answers questions about them. The codebase follows functional
core / imperative shell, TDD, pnpm, Vitest, and Zod v4 (`zod/v4` import path).

## Now
Current checkout is branch `cursor/repo-map-core-9ce6`. On 2026-07-09 an
adversarial branch review found three issues in the repo-map work, and local
uncommitted edits now address them: git-versioned memory stamps source commits
per agent at write time, tsconfig path aliases are basePath-aware, and three
extra EOF blank lines are removed. Tree is intentionally left dirty for Pedro
to inspect/commit.

## Verification path
- `pnpm run typecheck` — clean, run 2026-07-09.
- `pnpm run lint` — clean, run 2026-07-09.
- `pnpm test src/shell/git-markdown-block-storage.test.ts src/shell/tsconfig-loader.test.ts src/core/symbol-graph.test.ts src/core/tree-sitter-chunker.test.ts src/core/tree-sitter-refs-python.test.ts -- --runInBand` — 42 passed (42), run 2026-07-09.
- `pnpm test -- --runInBand` — 1157 passed (1157), 108 files, run
  2026-07-09. Invalid-ref `fatal:` stderr lines are expected from tests that
  exercise bad git refs.
- `git diff --check` — clean, run 2026-07-09.
- Full combined gate remains `pnpm run sanity`.

## Decisions
- Zod imports stay on `zod/v4`, not `zod`.
- Shell commands should use arg-array APIs (`execFileSync`/ports), not
  template-literal `execSync`.
- Core modules must not import from `src/shell/`; shell code depends inward.
- MCP tools with an `agent_id` should validate the agent against
  `admin.listAgents()` before provider/store reads or writes, so bad IDs return
  `agent not found: <id>` consistently.
- Bundled ESM entrypoints live in `dist/bin/`; package-root lookups from
  bundled code may need the two-level package layout.
- Orphaned sync checkpoints should fail fast with explicit recovery
  instructions instead of silently guessing a diff window.

## Landmines
- `node-git.test.ts` mocks `node:child_process` at module scope; real-git
  coverage belongs in `*.integration.test.ts`.
- Git log fixtures must be newest-first (real `git log` order).
- Vitest fake timers can report handled rejections as unhandled if
  `expect(p).rejects` attaches after `advanceTimersByTimeAsync`; attach the
  rejection expectation before flushing timers.
- PR/review state is external: re-fetch GitHub threads/checks before assuming
  PR #17 is still clean or still needs the same comments addressed.

## Next
1. Review and commit the uncommitted fixes on `cursor/repo-map-core-9ce6`.
2. Follow-up: `lastSyncAt` is only written by watch.ts, so sync-only users can
   never reach the `since` fallback; decide whether manual `sync` should stamp
   it too.
3. Follow-up coverage: `includeSubmodules: true` across the shared sync
   evidence paths, `sync --since <ref>` CLI-level coverage, and additional
   `install-instructions` CLI option tests.
