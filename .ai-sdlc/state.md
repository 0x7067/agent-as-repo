# Project State
updated: 2026-07-10

## Goal
repo-expert is a local-first CLI + MCP server that keeps semantic memory for
git repos and answers questions about them. The codebase follows functional
core / imperative shell, TDD, pnpm, Vitest, and Zod v4 (`zod/v4` import path).

## Now
Current checkout is `cursor/reduce-exploration-token-costs-612d`, already merged
at the same tip as `main`. All six branch-review findings are fixed locally:
read pagination reports returned lines, submodules and root aliases respect
basePath, passage headers fail safely when over budget, continuation chunks
share diversity limits, and the memory tool schema matches its handler. The
tree is intentionally dirty for Pedro to review and commit.

## Verification path
- Baseline `pnpm run sanity` — clean on 2026-07-10: lint/typecheck passed and
  1173 tests passed across 110 files.
- Focused regression command covering chunker, repo-path, result-budget,
  text-window, repo-tools, local-provider, watch, and CLI — 167 passed.
- Real Git integration: advanced a local submodule gitlink and ran CLI sync with
  `base_path` equal to the submodule; persisted paths were correctly rebased.
- Final `pnpm run sanity` — lint/typecheck clean; 1180 tests passed across 110
  files on 2026-07-10. `git diff --check` clean.

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
1. Review and commit the six branch-review fixes and regression tests.
2. Follow-up: decide whether manual `sync` should stamp `lastSyncAt`; today
   only watch writes it, so sync-only users cannot reach the `since` fallback.
3. Follow-up coverage: `sync --since <ref>` CLI behavior and additional
   `install-instructions` option tests.
