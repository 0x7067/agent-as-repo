# Project State
updated: 2026-07-06

## Goal
repo-expert: a CLI + MCP server that keeps a continuously synced semantic
memory of one or more repos (sqlite passage store + agent memory blocks) and
answers questions about them. Functional core / imperative shell, TDD, pnpm,
vitest, Zod v4 (`zod/v4` import path).

## Now
docs/plans/2026-07-06-auto-updating-context-spec.md is fully implemented.
All four items committed on branch `claude/auto-updating-docs-spec-8gi079`:

- `605e5e5` install-instructions command (spec item 4)
- `4d9b793` git evidence in consolidation prompts (spec item 1)
- `0731cf9` fingerprint no-op detection (spec item 2)
- `cdc44af` checkpoint fallback for sync (spec item 3)

Branch is local-only: not pushed, no PR, awaiting the user's review/merge.

## Verification path
- `pnpm test` — 931 passed (931), run 2026-07-06 on final tree (session
  baseline before any change: 851 passed).
- `pnpm run typecheck` (tsconfig.typecheck.json, noUncheckedIndexedAccess) — clean.
- `pnpm run lint` (`--max-warnings 0 --report-unused-disable-directives`) — clean.
- Full gate: `pnpm run sanity`.

## Decisions
- Sequential subagent phases over parallel worktrees: overlapping `src/cli.ts`
  edits and inter-item dependencies made merge risk cost more than parallelism.
- `sync --since <ref>` with an invalid ref still hard-fails: an explicit user
  override is a user error, not eligible for the checkpoint fallback chain.
- A never-synced agent (lastSyncCommit null) keeps the "No previous sync" skip;
  the fallback chain only rescues *orphaned* checkpoints (spec's Problem framing).
- No-op consolidation leaves zero state trace (spec line 58): repeated no-ops
  re-run the LLM turn; only lastConsolidatedCommit === HEAD === lastSyncCommit
  short-circuits pre-LLM.
- `lastConsolidatedCommit` is an additive optional state field — no schema
  version bump.

## Landmines
- Zod must be imported as `zod/v4`, not `zod` (repo CLAUDE.md).
- Shell commands: `execFileSync` with arg arrays only — never `execSync` with
  template literals.
- Core modules must not import from `src/shell/`; no mocks in core tests.
- `node-git.test.ts` mocks `node:child_process` at module scope — real-git
  coverage belongs in `*.integration.test.ts`, don't fight the mock.
- Git log test fixtures must be newest-first (real `git log` order); an
  oldest-first fixture once masked a truncation-direction bug.
- `REPO_EXPERT_TEST_FAKE_PROVIDER=1` makes `loadConfigForProvider` return
  `config: null` — CLI tests can't exercise real git wiring for any command
  except `sync`, which uses `loadConfigSafe` and loads real config.

## Next
1. User (pedro) reviews/merges `claude/auto-updating-docs-spec-8gi079` —
   external dependency; re-verify branch state before building on it.
2. Follow-up: `lastSyncAt` is only written by watch.ts, so sync-only users
   can never reach the `since` fallback (they skip range → recent/full).
   Decide whether manual `sync` should also stamp `lastSyncAt`.
3. Follow-up: cover `filterChangedFiles` `includeSubmodules: true` in
   combination with the new fallback branches (currently only the plain
   `--since` path exercises it).
4. Optional: harness fix so the fake provider stops nulling config for
   non-sync commands (unblocks CLI-level git-wiring tests broadly).
