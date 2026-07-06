# Project State
updated: 2026-07-06

## Goal
repo-expert: a CLI + MCP server that keeps a continuously synced semantic
memory of one or more repos (sqlite passage store + agent memory blocks) and
answers questions about them. Functional core / imperative shell, TDD, pnpm,
vitest, Zod v4 (`zod/v4` import path).

## Now
docs/plans/2026-07-06-auto-updating-context-spec.md is fully implemented
on branch `claude/auto-updating-docs-spec-8gi079`, **pushed** to origin
(github.com:0x7067/agent-as-repo) through `4d019f9`. No PR opened yet.

- `605e5e5` install-instructions command (spec item 4)
- `4d9b793` git evidence in consolidation prompts (spec item 1)
- `0731cf9` fingerprint no-op detection (spec item 2)
- `cdc44af` checkpoint fallback for sync (spec item 3)
- `6c49f3b` refactor: orphaned sync checkpoint now **fails fast** with
  recovery instructions (`--since <ref>` / `--full`) instead of silently
  guessing a diff window — supersedes cdc44af's silent fallback chain
- `4d019f9` spec doc re-synced with implemented behavior (teammate audit
  found 3/4 items compliant, 4 doc-only stale passages; all fixed)

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
  override is a user error, not eligible for automatic recovery.
- **Superseded decision (6c49f3b):** cdc44af's silent fallback chain for
  orphaned checkpoints (checkpoint → since → recent/full) was replaced by
  fail-fast with explicit recovery instructions. Rationale: silently guessing
  a diff window corrupts memory scope; a hard stop is recoverable, corrupted
  agent memory is not. The spec doc was updated to match (4d019f9).
- A never-synced agent (lastSyncCommit null) keeps the "No previous sync" skip;
  orphan detection only applies to previously-synced agents.
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
1. Open a PR for `claude/auto-updating-docs-spec-8gi079` (pushed through
   `4d019f9`, no PR yet) and get pedro's review/merge — external
   dependency; re-verify branch/PR state before building on it.
2. Follow-up: `lastSyncAt` is only written by watch.ts, so sync-only users
   can never reach the `since` fallback (they skip range → recent/full).
   Decide whether manual `sync` should also stamp `lastSyncAt`.
3. Follow-up: cover `filterChangedFiles` `includeSubmodules: true` in
   combination with the new fallback branches (currently only the plain
   `--since` path exercises it).
4. Optional: harness fix so the fake provider stops nulling config for
   non-sync commands (unblocks CLI-level git-wiring tests broadly).
