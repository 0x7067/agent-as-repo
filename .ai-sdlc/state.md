# Project State
updated: 2026-07-07

## Goal
repo-expert is a local-first CLI + MCP server that keeps semantic memory for
one or more git repos (sqlite passage store + agent memory blocks) and answers
questions about them. The codebase follows functional core / imperative shell,
TDD, pnpm, Vitest, and Zod v4 (`zod/v4` import path).

## Now
Current checkout is branch `claude/product-refinement-polish-so4rj9`, backing
GitHub PR #17: https://github.com/0x7067/agent-as-repo/pull/17. On
2026-07-07, two unresolved Devin review threads were addressed locally:
`readPackageVersion` now supports both source (`src/`) and bundled
(`dist/bin/`) package layouts, and every agent-scoped MCP tool checks agent
existence before provider/store side effects.

The user had a pre-existing local deletion in `.codex/config.toml`; it is
unrelated to PR #17 comment work and should stay out of commits unless Pedro
asks for it.

## Verification path
- `pnpm test src/mcp-server.test.ts` — 49 passed (49), run 2026-07-07.
- `pnpm run typecheck` — clean, run 2026-07-07.
- `pnpm build` — clean, run 2026-07-07; follow-up `node -e` import of
  `dist/bin/mcp-server.mjs` returned package version `1.0.0` matching
  `package.json`.
- `pnpm run lint` — clean, run 2026-07-07.
- `pnpm test` — 1015 passed (1015), 85 files, run 2026-07-07. Invalid-ref
  `fatal:` stderr lines are expected from tests that exercise bad git refs.
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
1. If resuming PR #17, re-fetch GitHub review threads and CI before acting.
2. Leave the unrelated `.codex/config.toml` deletion unstaged unless Pedro
   asks for it.
3. Follow-up: `lastSyncAt` is only written by watch.ts, so sync-only users can
   never reach the `since` fallback; decide whether manual `sync` should stamp
   it too.
4. Follow-up coverage: `includeSubmodules: true` across the shared sync
   evidence paths, `sync --since <ref>` CLI-level coverage, and additional
   `install-instructions` CLI option tests.
