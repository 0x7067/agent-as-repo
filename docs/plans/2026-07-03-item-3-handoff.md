# Handoff: agent-as-repo follow-ups — item 3 (embedded sqlite-vec store)

Date: 2026-07-03
Status: handoff prompt for the next session
Depends on: `2026-07-03-follow-ups-plan.md` (items 1, 2, 4 landed),
`2026-07-03-sea-native-addon-spike.md` (GO verdict)

## Where things stand

Branch `claude/follow-ups-plan-delegation-xz4s28` is pushed and complete (no PR
opened yet — open/merge it first if that hasn't happened). It contains, per
`docs/plans/2026-07-03-follow-ups-plan.md`:

- Item 1 — `ask --fast` restored via optional `provider.fast_model`
  (flag → config → explicit error; the legacy-rejection branch in
  `src/core/config.ts` was removed; `--all` broadcast applies the override too).
- Item 2 — `doctor --strict` (warnings → non-zero exit via pure
  `computeDoctorExitCode` in `src/core/doctor.ts`; check functions untouched).
- Item 4 — summarize-on-sync consolidation: pure `src/core/consolidate.ts`
  (`buildConsolidationPrompt`, stateless `shouldConsolidate`), shell runner
  `src/shell/consolidate.ts`, new `AgentProvider.consolidateMemory` port method
  exposing ONLY `memory_replace` (persona rejected in the handler; oversized
  blocks rejected, not truncated), config `defaults.consolidate_on_sync`
  (default false) + `consolidate_min_files_changed` (default 5), CLI
  `consolidate [--repo]`, hooks in the sync command and watch loop.
- `self-check` chmod-000 test now `skipIf` root; lint/typecheck/test all clean
  (712 passed, 1 root-only skip).
- Item 3's phase-1 gate is ANSWERED: `docs/plans/2026-07-03-sea-native-addon-spike.md`
  — verdict GO, empirically verified.

## Your task: item 3, phases 2–5 — replace OpenViking with embedded sqlite-vec

Read `docs/plans/2026-07-03-follow-ups-plan.md` (item 3) and the spike report
first; they are authoritative. Work on a NEW branch off the merged default
branch (the plan says item 3 gets its own branch). Phases:

2. Extract `src/ports/passage-store.ts` (narrow surface viking-provider
   actually uses: initAgent, deleteAgent, writePassage, readPassage,
   deletePassage, listPassages, semanticSearch) + thin adapter over
   `VikingHttpClient`. Behavior-preserving; suite stays green.
3. `embed(texts: string[])` in `src/shell/llm-client.ts` →
   `POST {base_url}/embeddings`; config `provider.embedding_model`
   (default `nomic-embed-text`).
4. `src/shell/sqlite-store.ts` (better-sqlite3 + sqlite-vec, one DB at
   `~/.repo-expert/store.db`, `passages` table + `vec0` virtual table;
   per-file resync = DELETE by agent_id+file_path; keep writing passage IDs
   to `.repo-expert-state.json` so reconcile semantics are unchanged) +
   parametrized contract tests run against BOTH store impls.
5. Swap default; DELETE `viking-http.ts`, `openviking-paths.ts`, `viking_url`
   config key, `VIKING_API_KEY`; re-evaluate `viking-provider.ts` naming
   (→ `local-provider.ts` or similar); docs + `setup --reindex` migration note.
   Also consider moving `FilesystemBlockStorage` blocks into the same DB
   (plan prefers one substrate), and revisit item 4's consolidation block
   storage accordingly.

## Load-bearing spike facts (don't rediscover these)

- SEA can load the natives; ship them as SEA assets, extract to a cached
  versioned dir at runtime (dlopen needs a real path). Shim:
  `process.dlopen(m, addonPath)` then
  `new Database(path, {nativeBinding: m.exports})` and
  `db.loadExtension(absVec0Path)` — do NOT use the `bindings` package or
  `sqliteVec.load()` (both break inside SEA).
- `better_sqlite3.node` is ABI-locked to the exact Node major of the SEA
  build (had to compile from source on Node 22); `vec0.so` is platform-only.
- sqlite-vec platform packages (`sqlite-vec-linux-x64` etc.) are
  optionalDependencies pnpm skips — add explicitly per target; better-sqlite3's
  build script needs `pnpm approve-builds`.
- vec0 rowids must be bound as BigInt (`1n`) — plain JS numbers bind as float
  and vec0 rejects float primary keys.
- Update `scripts/build-sea.sh` / sea-config JSONs with an `assets` section and
  a native-artifact staging step.

## Conventions (CLAUDE.md applies)

TDD red-green, colocated vitest tests, no mocks in core tests, functional
core/imperative shell, pnpm only, `import { z } from "zod/v4"`, phases land as
separate green commits. Delegation pattern that worked well last session:
sonnet Explore agents for code-mapping, opus general-purpose agents for
implementation, worktree isolation when two agents must edit concurrently.
