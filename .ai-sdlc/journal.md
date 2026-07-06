# Journal

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
