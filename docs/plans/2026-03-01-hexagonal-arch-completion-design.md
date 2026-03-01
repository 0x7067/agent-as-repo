# Design: Hexagonal Architecture Completion

**Date:** 2026-03-01
**Branch:** rewrite
**Status:** Approved

## Context

The `rewrite` branch introduced hexagonal architecture (ports and adapters) and has completed ~85% of the migration. Three ports exist (`FileSystemPort`, `GitPort`, `AdminPort`), their adapters are in `src/shell/adapters/`, and four shell modules have been migrated to use dependency-injected ports.

Four shell modules remain that bypass ports and use `node:fs` / `node:child_process` directly: `doctor.ts`, `init.ts`, `self-check.ts`, and `watch.ts`. `AgentProvider` lives in `src/shell/` rather than `src/ports/`. Shell mutation testing thresholds are currently set to 0%.

## Goal

Complete the hexagonal architecture migration so that every module with I/O uses a port interface, enforced by the existing ESLint boundary rules and testable without real filesystem or git access.

## Architecture

Three sequential waves of parallel work:

```
Wave 1 (parallel)
├── Expand GitPort + nodeGit adapter
├── Expand FileSystemPort + nodeFileSystem adapter
└── Move AgentProvider → src/ports/agent-provider.ts

Wave 2 (parallel, depends on Wave 1)
├── Migrate doctor.ts
├── Migrate init.ts
├── Migrate self-check.ts
└── Migrate watch.ts

Wave 3 (sequential, depends on Wave 2)
└── Raise shell Stryker threshold + verify full suite
```

## Components

### Wave 1: Port Expansions

**GitPort** (`src/ports/git.ts`) — add three methods:
- `version(): string` — runs `git --version`, used by `doctor.ts`
- `headCommit(cwd: string): string | null` — runs `git rev-parse HEAD`, used by `watch.ts`
- `diffFiles(cwd: string, sinceRef: string): string[] | null` — runs `git diff --name-only sinceRef..HEAD`, used by `watch.ts`

**FileSystemPort** (`src/ports/filesystem.ts`) — two changes:
- Extend `GlobOptions` with `deep?: number`, `onlyFiles?: boolean`, `followSymbolicLinks?: boolean` (needed by `init.ts` `scanFilePaths`)
- Add `watch(path: string, options: { recursive?: boolean }, listener: (event: string, filename: string | null) => void): FSWatcher`

**NodeGit adapter** (`src/shell/adapters/node-git.ts`) — implement the three new `GitPort` methods.

**NodeFilesystem adapter** (`src/shell/adapters/node-filesystem.ts`) — implement `watch` and pass the extended glob options through to fast-glob.

**AgentProvider** — move interface from `src/shell/provider.ts` → `src/ports/agent-provider.ts`. Re-export from `src/shell/provider.ts` for backwards compatibility.

### Wave 2: Shell Module Migration

Each module follows the existing pattern from `file-collector.ts`: add optional port parameters that default to the real adapters so call sites require no changes.

**`doctor.ts`**
- Accept optional `fs?: FileSystemPort` and `git?: GitPort` parameters on functions that need I/O
- Accept `cwd?: string` parameter (default `process.cwd()`) instead of relying on implicit cwd
- Replace `execFileSync("git", ["--version"])` with `git.version()`
- Replace all `node:fs/promises` calls with `fs.*` port methods
- Tests: replace temp-directory setup with in-memory port fakes; inject cwd

**`init.ts`**
- Accept optional `fs?: FileSystemPort` and `cwd?: string` on `runInit`
- Replace `fast-glob` direct call with `fs.glob(...)` using extended options
- Replace all `node:fs/promises` calls with `fs.*` port methods
- Tests: replace temp-directory setup with in-memory port fakes; inject cwd

**`self-check.ts`**
- Accept optional `fs?: FileSystemPort` and `runCommand?: (cmd: string, args: string[], cwd: string) => string` on `runSelfChecks`
- Replace `execFileSync("pnpm", ...)` with `runCommand("pnpm", ...)`
- Replace `node:fs/promises` calls with `fs.*` port methods
- Tests: replace real-fs tests with port fakes; inject a mock `runCommand`

**`watch.ts`**
- Accept optional `fs?: FileSystemPort` and `git?: GitPort` on `watchRepos`
- Replace `execFileSync("git", ["rev-parse", ...])` with `git.headCommit(cwd)`
- Replace `execFileSync("git", ["diff", ...])` with `git.diffFiles(cwd, sinceRef)`
- Replace `node:fs` `watch()` call with `fs.watch(...)`
- Replace `node:fs/promises` calls with `fs.*` port methods
- Tests: replace `vi.mock("node:child_process")` and `vi.mock("node:fs")` with injected port fakes

### Wave 3: Mutation Threshold

After all shell modules use ports and tests use fakes:
- Raise `stryker.shell.config.mjs` `threshold.break` from `0` to `70`
- Run full Stryker suite; kill any surviving mutants by adding targeted tests
- Verify `pnpm test` passes completely

## Testing Strategy

- **Core tests**: no changes needed (already pure)
- **Shell tests after migration**: in-memory fake implementations of `FileSystemPort` and `GitPort` instead of temp directories and real binaries
  - Pattern: small objects conforming to the port interface with `Map`-backed storage or return values set in `beforeEach`
- **Architecture test** (`src/__tests__/architecture.test.ts`): no changes needed — existing boundary enforcement already covers the new port locations
- **Stryker**: Wave 3 raises the shell threshold after tests are good enough to catch mutations

## Key Invariants

- No call site (CLI, MCP server, or other shell modules) requires changes — all new port params are optional with real-adapter defaults
- `AgentProvider` re-export from `src/shell/provider.ts` maintains backwards compatibility
- The ESLint `no-restricted-imports` rule already blocks core modules from importing `node:fs` or `node:child_process` — the shell modules are exempt from this rule by design
- `Promise.race` with `setTimeout` in any watch logic: always store timer ID and `clearTimeout` in `finally` (per project convention)
