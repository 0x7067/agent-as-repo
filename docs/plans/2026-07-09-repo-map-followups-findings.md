# Repo-map follow-ups — Findings

Date: 2026-07-09
Status: landed (Python/Go refs, path aliases, PageRank→consolidate, git memory Phase A)
Depends on: repo-map core (PR #20)

## What landed

### 1. Multi-language refs
- `src/core/tree-sitter-refs-python.ts` — import / from-import / calls
- `src/core/tree-sitter-refs-go.ts` — import_spec / call_expression
- Dispatched from `extractSymbolsAndRefsFromFile`
- Python relative imports (`.foo`) resolve via `resolvePythonRelativeModule`
- Go package paths still unresolved to files (no go.mod mapping yet)

### 2. Path aliases
- Pure `src/core/tsconfig-paths.ts` (`parsePathAliasConfig`, `expandPathAlias`)
- Shell loader `src/shell/tsconfig-loader.ts` reads repo-root tsconfig/jsconfig
- `resolveModuleSpecifier` + `buildSymbolGraph({ pathAliases })` + sync/setup wiring

### 3. PageRank → core memory
- `formatTopSymbolsEvidence` in `src/core/symbol-summary.ts`
- Injected into consolidation prompts (CLI sync/consolidate + watch)

### 4. Git-versioned memory (Phase A)
- Markdown format: `src/core/memory-markdown.ts`
- `GitMarkdownBlockStorage` implements `BlockStorage`
- Config: `memory.git_versioned` + `memory.dir` (see `config.example.yaml`)
- **Not yet:** worktree-isolated consolidate, auto-commit, sleep-time job

## Follow-ups still open
- Worktree-isolated consolidate + commit provenance (Phase B)
- Go module path → directory resolution
- Multi-tsconfig / project references
