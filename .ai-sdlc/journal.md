# Journal

## 2026-07-06 — Fail-fast checkpoint refactor, spec audit, doc sync, branch pushed
- Did: replaced cdc44af's silent orphaned-checkpoint fallback chain with
  fail-fast + recovery instructions (`6c49f3b`) at the user's direction —
  sync now hard-stops on an orphaned checkpoint and tells the user to re-run
  with `--since <ref>` or `--full` instead of guessing a diff window. Ran a
  teammate spec audit (`spec-audit`): verdict 3/4 items COMPLIANT, item 3
  compliant-in-behavior with 4 doc-only stale passages. A second teammate
  (`spec-doc-fix`) rewrote those passages; reviewed and committed as
  `4d019f9`. Pushed the whole branch to origin (was local-only).
- Verified: pnpm test 931 passed (931) on the post-refactor tree; pnpm run
  typecheck clean; pnpm run lint --max-warnings 0 clean. Final commit
  4d019f9 is docs-only (19+/14-, single .md file) — gates not re-run after
  it, by inspection of `git diff --stat`.
- Learned: truly orphaning a checkpoint in tests needs `commit --amend` +
  `reflog expire` + `gc --prune=now`; teammate audits catch spec/code drift
  the implementer reads past.
- Left: no PR yet (branch pushed through 4d019f9); state.md Next items 2–4
  (lastSyncAt gap, includeSubmodules × fallback coverage, fake-provider
  harness fix) still open; distrust the pre-6c49f3b journal entry's claim
  that a fallback *chain* exists — it was removed.

## 2026-07-06 — Implemented auto-updating-context spec (all 4 items, subagent-delegated)
- Did: implemented docs/plans/2026-07-06-auto-updating-context-spec.md as four
  sequential phases, each delegated to a Sonnet subagent with the main session
  reviewing and committing. Commits: 605e5e5 (install-instructions), 4d9b793
  (git evidence in consolidation), 0731cf9 (fingerprint no-op detection),
  cdc44af (sync checkpoint fallback + GitPort routing cleanup). Phase 2 review
  caught a truncation-direction bug hidden by an oldest-first fixture (fixed
  before commit). Phase 4's agent was interrupted by a provider session limit
  and resumed from its own working-tree diff without loss.
- Verified: pnpm test 931 passed (931) on the final tree (baseline 851 at
  session start); pnpm run typecheck clean; pnpm run lint --max-warnings 0
  clean; per-phase gate runs before each of the four commits; branch-wide
  scope check (git diff 605e5e5^..HEAD --name-only) shows only src/ files,
  no config/CLAUDE.md/permission changes.
- Learned: REPO_EXPERT_TEST_FAKE_PROVIDER=1 nulls config via
  loadConfigForProvider but NOT for sync (loadConfigSafe) — sync CLI tests
  can drive real temp git repos, including orphaned-checkpoint scenarios
  (needs commit --amend + reflog expire + gc --prune=now to truly orphan).
  Git log fixtures must mirror real newest-first output or they mask
  direction bugs.
- Left: branch unpushed/unmerged (user review pending); lastSyncAt/watch-only
  gap keeps sync-only users off the `since` fallback; includeSubmodules ×
  fallback-branch coverage gap; distrust any assumption that the spec's
  "current state" sections still describe the code — items landed with
  extractions (filterChangedFiles, parseNameOnlyLog) not named in the spec.

## 2026-07-06 — Two-teammate PR review of claude/auto-updating-docs-spec-8gi079 (through 4d019f9)
- pr-review-logic (Opus): APPROVE, no blockers. Verified evidence-source
  precedence, fail-fast checkpoint semantics, fingerprint no-op path.
- pr-review-tests (Sonnet): REQUEST_CHANGES. Two majors: (1) sync-triggered
  auto-consolidation (cli.ts:1345-1368) and manual consolidate git branches
  (cli.ts:415-475) have zero end-to-end coverage — FAKE_PROVIDER nulls config
  so the wiring never runs under test; (2) watch.ts untouched — daemon still
  silently mis-scopes on orphaned checkpoints (watch.ts:174-179), needs an
  explicit fix-or-out-of-scope decision. Minors + nits recorded in state.md.
- Test count reconciled: 921 passed (921) / 82 files is correct; the 931 in
  state.md was stale (pre-6c49f3b). Fixed.
- Both reviewers shut down cleanly. Findings folded into state.md Next 1-3, 6.

## 2026-07-06 — Phase A review fixes landed (subagent, Sonnet)
- `5a696aa` fix(cli): REPO_EXPERT_TEST_FAKE_PROVIDER now loads real config
  via loadOptionalConfig instead of hardcoding null — kills the harness
  trap that made consolidate's git wiring untestable. Zero behavior change
  for existing tests (none write config.yaml on affected paths).
- `7a797b8` test(cli): 6 new CLI-level tests. Sync auto-consolidation ×3
  (checkpoint-range, --since, --full omitted-evidence) + manual
  consolidate ×3 (success stamp, no-op skip byte-identical state,
  orphaned-checkpoint fail-fast via bogus SHA). Added
  REPO_EXPERT_TEST_ECHO_PROMPT hook to FakeProvider so subprocess tests
  can assert prompt contents (mirrors ECHO_MODEL pattern).
- Suite: 921 → 927 passed, 82 files; sanity gate fully green.
- Review majors 1/1b closed. Phase B (watch.ts parity) started next.

## 2026-07-06 — Phase B: watch.ts daemon parity (review MAJOR 2 closed)
- Did: extracted `gatherGitEvidence` out of cli.ts into a new
  `src/shell/git-evidence.ts` (takes an injected `GitPort` instead of the
  module-level `nodeGit`), reused it from both `consolidateRepoAgent`
  (cli.ts) and watch.ts's daemon consolidation. Added
  `formatOrphanedCheckpointMessage` to `core/git-evidence.ts` so `sync` and
  the watch daemon share identical recovery wording (manual `consolidate`
  keeps its distinct "Re-establish it with..." text, asserted by an
  existing cli.test.ts test — left alone). In watch.ts: post-sync
  consolidation now passes `gitEvidence` into `consolidateAgentMemory` and
  stamps `lastConsolidatedCommit` only when `consolidation.changed` is
  true (no-op leaves zero trace, matching cli.ts semantics). Added
  checkpoint validation to the polling diff path
  (`resolveChangedFiles`) — `OrphanedCheckpointError` on a missing
  checkpoint instead of the old log-and-continue. Wired a `fatalError` +
  hoisted `shutdown()`/`settle` mechanism through `watchRepos` so an
  orphaned checkpoint detected anywhere (first tick, later interval tick,
  or a debounced event-driven flush via `trackTask`'s `.finally`) tears
  down timers/watchers/in-flight tasks and makes the `watchRepos(...)`
  promise reject; cli.ts's `watch` command action catches
  `OrphanedCheckpointError` and sets `process.exitCode = 1`. Non-orphan
  git failures (e.g. index.lock) still just skip the tick, unchanged.
- Verified: `pnpm test` 927 → 940 passed, 82 → 83 files (new
  `shell/git-evidence.test.ts`); `pnpm run typecheck` clean; `pnpm run
  lint --max-warnings 0` clean; `pnpm run sanity` full gate green.
- Learned: `expect(promise).rejects...` attached *after* the
  `vi.advanceTimersByTimeAsync()` call that actually settles the promise
  produces a spurious `PromiseRejectionHandledWarning` under vitest fake
  timers even though the test does go on to handle it — fix is
  `await Promise.all([expect(p).rejects..., vi.advanceTimersByTimeAsync(0)])`
  so the handler registers before the flush. Also: TS's flow narrowing
  doesn't see mutations to a closed-over `let` made from nested async
  closures reached only via an awaited call — `fatalError`'s read/throw
  needed two targeted eslint-disable comments (`no-unnecessary-condition`,
  `only-throw-error`) rather than a real narrowing fix.
- Left: PR still not opened (external dependency); state.md Next items
  2-4 (lastSyncAt gap, includeSubmodules × fallback coverage, misc review
  minors) still open. Phase A + Phase B commits are local-only — branch
  was pushed through `4d019f9` only.

## 2026-07-06 — Phase B landed, branch pushed, PR #16 opened
- Phase B (subagent, Sonnet): `ee2ea9a` extracted shared shell
  gatherGitEvidence; `f2c0598` watch daemon parity (evidence in daemon
  consolidation, lastConsolidatedCommit stamp on change only, orphaned
  checkpoint → clean loop teardown + exit 1 + shared recovery message via
  formatOrphanedCheckpointMessage; transient git failures stay non-fatal);
  `32fa917` state/journal/spec-doc sync. Suite 927 → 940 (940), 83 files.
- Pushed 789d052..32fa917 to origin.
- PR #16 opened: https://github.com/0x7067/agent-as-repo/pull/16. Note:
  gh's active account tc-pguimaraes is not a collaborator on
  0x7067/agent-as-repo — PR created after `gh auth switch --user 0x7067`,
  then switched back. Future sessions hitting "must be a collaborator"
  on this repo: same fix.
- All review majors resolved; remaining minors tracked in state.md Next.

## 2026-07-07 — Addressed PR #17 MCP review threads
- Did: fetched thread-aware GitHub review data for PR #17 on branch
  `claude/product-refinement-polish-so4rj9` and addressed both unresolved,
  non-outdated Devin threads. `readPackageVersion` now tries both source
  (`../package.json`) and bundled `dist/bin` (`../../package.json`) layouts,
  preserving the SEA fallback. `agent_search_archival`,
  `agent_insert_passage`, `agent_delete_passage`, and `agent_update_block`
  now call the existing `assertAgentExists` guard before provider/store side
  effects so bad `agent_id` values consistently return `agent not found`.
- Verified: `pnpm test src/mcp-server.test.ts` passed 49 tests;
  `pnpm run typecheck` clean; `pnpm build` clean; `node -e` import of
  `dist/bin/mcp-server.mjs` returned
  `{"version":"1.0.0","expected":"1.0.0","matches":true}`;
  `pnpm run lint` clean; `pnpm test` passed 1015 tests across 85 files
  (invalid-ref `fatal:` stderr is expected test coverage); `git diff --check`
  clean.
- Learned: changing the version path directly to `../../package.json` would
  fix bundled output but break the source/tsx path, so the reader needs
  layout candidates rather than one relative path.
- Left: re-fetch PR #17 review/CI state before further changes; do not stage
  the pre-existing `.codex/config.toml` deletion unless Pedro asks for it.

## 2026-07-07 — Committed repo-local Codex config deletion
- Did: at Pedro's follow-up request, included the tracked deletion of
  `.codex/config.toml` as a separate commit on the PR #17 branch.
- Verified: `check-state.sh` OK and `git diff --check` clean.
- Learned: nothing new.
- Left: re-fetch PR #17 review/CI state before further changes.

## 2026-07-09 — Addressed repo-map branch adversarial review findings
- Did: fixed git-versioned markdown memory provenance by resolving
  `source_commit` per agent at write time; made tsconfig/jsconfig path alias
  loading basePath-aware by preferring package-local configs and rebasing
  root aliases to agent-relative paths; removed three extra EOF blank lines
  reported by `git diff --check`.
- Verified: `pnpm run typecheck` clean; focused vitest command for markdown
  storage, tsconfig loader, and whitespace-touched symbol tests passed 42
  tests; `pnpm run lint` clean; `pnpm test -- --runInBand` passed 1157 tests
  across 108 files; `git diff --check` clean.
- Learned: `loadPathAliasesFromRepo` must see `RepoConfig.basePath` because
  symbol files are stored relative to the agent root, not necessarily the git
  repo root. Git-versioned memory cannot safely stamp a provider-global commit
  when one provider spans multiple repos or a long-running watch process.
- Left: source tree intentionally dirty with the review-fix edits for Pedro
  to inspect and commit.
