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
Key commits: `4d9b793`/`0731cf9`/`cdc44af` (spec items 1-3), `6c49f3b`
(orphaned checkpoint now fails fast, superseding cdc44af's silent
fallback), `605e5e5` (install-instructions, item 4), `4d019f9` (spec doc
re-sync).

Two-teammate PR review completed (Opus: APPROVE; Sonnet: REQUEST_CHANGES,
2 majors). Both majors now resolved (Phase A: `5a696aa`/`7a797b8`; Phase
B: this session, local-only, not yet committed as of writing this line).
PR still not opened.

Phase B (watch.ts daemon parity, review MAJOR 2) landed: the daemon now
gathers git evidence for post-sync consolidation via the same
`gatherGitEvidence` helper manual `consolidate` uses (extracted to
`src/shell/git-evidence.ts`, shared by cli.ts and watch.ts), stamps
`lastConsolidatedCommit` only when consolidation actually changes a block,
and fails fast on an orphaned checkpoint: the watch loop stops cleanly
(timers/watchers torn down, in-flight tasks awaited), rejects so the CLI
exits non-zero, and prints the same `--since <ref>` / `--full` recovery
text as `sync` (`core/git-evidence.ts`'s new
`formatOrphanedCheckpointMessage`). Non-orphan git failures (index.lock,
etc.) stay non-fatal.

## Verification path
- `pnpm test` — 940 passed (940), 83 files, run 2026-07-06 after Phase B
  (927 at Phase A; 921 at review time; session baseline before any change:
  851 passed).
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
- Daemon evidence-gathering mirrors manual `consolidate` (checkpoint-based
  `gatherGitEvidence`), not `sync` (exact-diff-window evidence): the
  daemon's "never synced" case is exactly what `selectEvidenceSource`'s
  since/recent fallback exists for, unlike `sync --full`'s explicit
  user override with no natural window.
- The orphaned-checkpoint recovery message text is shared (`core/git-evidence.ts`'s
  `formatOrphanedCheckpointMessage`) between `sync` and the watch daemon;
  manual `consolidate`'s distinct "Re-establish it with..." wording was left
  as-is (existing cli.test.ts assertion, no behavior reason to unify).

## Landmines
- Zod must be imported as `zod/v4`, not `zod` (repo CLAUDE.md).
- Shell commands: `execFileSync` with arg arrays only — never `execSync` with
  template literals.
- Core modules must not import from `src/shell/`; no mocks in core tests.
- `node-git.test.ts` mocks `node:child_process` at module scope — real-git
  coverage belongs in `*.integration.test.ts`, don't fight the mock.
- Git log test fixtures must be newest-first (real `git log` order); an
  oldest-first fixture once masked a truncation-direction bug.
- `REPO_EXPERT_TEST_FAKE_PROVIDER=1` now loads real config when a
  config.yaml exists (`loadOptionalConfig`, fixed in `5a696aa`) — the old
  hardcoded `config: null` trap is gone. `REPO_EXPERT_TEST_ECHO_PROMPT`
  makes FakeProvider echo the consolidation prompt so subprocess CLI tests
  can assert on prompt contents (mirrors `REPO_EXPERT_TEST_ECHO_MODEL`).
- Vitest + fake timers: `expect(promise).rejects...` registered *after* a
  `vi.advanceTimersByTimeAsync()` call that settles the promise triggers a
  spurious `PromiseRejectionHandledWarning`/unhandled-error report even
  though the test does handle it. Fix: `await Promise.all([expect(p).rejects...,
  vi.advanceTimersByTimeAsync(0)])` so the handler attaches before the flush.
- `watch.test.ts`'s `makeFakeGit` defaults now include `commitExists: true`
  and `logNameStatus: ""` — any new test overriding one should usually set
  the other too when simulating a specific evidence/orphan scenario.

## Next
1. Both PR review majors are **RESOLVED**: MAJOR 1/1b (sync + manual
   consolidate git-wiring untested) in `5a696aa`+`7a797b8` (Phase A);
   MAJOR 2 (watch.ts daemon parity) this session (Phase B) — see Now/
   Decisions above. 9 new tests landed with Phase B (927→940).
2. ~~Open a PR~~ **DONE**: branch pushed through `32fa917` and PR #16
   opened (https://github.com/0x7067/agent-as-repo/pull/16, created as
   0x7067 — gh's active account `tc-pguimaraes` is not a collaborator;
   switched back after). Awaiting pedro's review/merge — external
   dependency; re-verify PR state before building on it.
3. Follow-up: `lastSyncAt` is only written by watch.ts, so sync-only users
   can never reach the `since` fallback (they skip range → recent/full).
   Decide whether manual `sync` should also stamp `lastSyncAt`.
4. Follow-up (review minors, all pre-existing, untouched by Phase B):
   `includeSubmodules: true` × the three sync evidence paths (blast radius
   grew via shared `filterChangedFiles`, cli.ts:393-408); `sync --since
   <ref>` CLI-level test; CLI-layer tests for `install-instructions --repo`
   unknown-repo /`--file`/`--dry-run`; cli.test.ts:594 vs :636 duplicate
   coverage; `formatGitEvidence` with a single commit > maxChars.
