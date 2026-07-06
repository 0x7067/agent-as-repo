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
