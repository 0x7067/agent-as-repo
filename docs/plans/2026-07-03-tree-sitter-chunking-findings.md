# Tree-sitter Chunking Findings

**Date:** 2026-07-03  
**Spike:** `spikes/09-tree-sitter-chunking.ts`  
**Scope:** TypeScript/JavaScript symbol-boundary chunking (Wave 5, Task 13)

## Executive Summary

**Recommendation: adopt `web-tree-sitter` + WASM grammars shipped by `tree-sitter-typescript` (and `tree-sitter-javascript` for `.js`/`.jsx`).**

Do **not** use the native `tree-sitter-typescript` Node bindings (`bindings/node`, `node-gyp-build`) in production — they require prebuild/native compilation and conflict with this project's SEA/npm portability goals.

Offline spike passed on representative repo files. Symbol-boundary chunking produces meaningful, retrieval-friendly prefixes and keeps average chunk sizes well under the 2KB raw limit on large files like `src/cli.ts` (64 symbols, ~360 chars avg vs monolithic raw chunks).

## Spike Results

| File | Lines | Parse | Symbols | Avg chars | Fallback? |
|---|---:|---|---:|---:|---|
| `src/core/chunker.ts` | 38 | ok | 2 | 616 | no |
| `src/shell/sync.ts` | 138 | ok | 6 | 665 | no |
| `src/cli.ts` | 1,851 | ok | 64 | 360 | no |

### Benchmark (40 non-test files under `src/core/` + `src/shell/`)

| Metric | Value |
|---|---|
| Total parse time | 31.3 ms |
| Per file | 0.78 ms |
| Extrapolated 1,000 files | ~0.8 s |
| Extrapolated 5,000 files | ~3.9 s |
| Files with `hasError` (partial parse) | 1 (`src/shell/viking-http.ts` — still extracted symbols) |
| Zero-symbol files | 1 (fallback to `rawTextStrategy`) |

Parsing latency is negligible relative to Letta passage ingestion (Phase 0 measured ~126 ms/passage at p=20). Tree-sitter parse cost is not the bottleneck.

## Library Decision

### Chosen: `web-tree-sitter` + WASM grammars

| Package | Role |
|---|---|
| `web-tree-sitter` | Parser runtime (WASM, no native compile) |
| `tree-sitter-typescript` | Ships `tree-sitter-typescript.wasm` + `tree-sitter-tsx.wasm` |
| `tree-sitter-javascript` (transitive) | Ships `tree-sitter-javascript.wasm` for `.js`/`.jsx` |

### Rejected: native `tree-sitter` / `tree-sitter-typescript` bindings

- `tree-sitter-typescript@0.23.2` runs `node-gyp-build` on install
- Depends on optional peer `tree-sitter` native module
- Prebuilds exist but add platform/arch matrix risk for SEA binaries (`scripts/build-sea.sh`) and contributor machines without build tools

### Bundling / SEA considerations

- `esbuild` **can** bundle `web-tree-sitter` JS (verified: spike entry bundles to ESM successfully)
- WASM files **cannot** be inlined by default — they must be shipped beside the bundle:
  - ESM CLI (`dist/cli.mjs`): copy `web-tree-sitter.wasm`, `tree-sitter-typescript.wasm`, `tree-sitter-tsx.wasm`, `tree-sitter-javascript.wasm` into `dist/` and point `Parser.init({ locateFile })` at those paths
  - SEA CJS (`dist/sea-cli.cjs`): same requirement; postject/SEA packaging must include WASM assets or chunking falls back to raw
- **Task 14 follow-up:** add a build step in `scripts/build.ts` to copy WASM assets into `dist/`; document SEA limitation if WASM embedding is deferred

## Chunk Prefix Format (pinned for Task 14)

Passage text prefix format — extends today's `FILE: <path>` convention:

```
FILE: <path> | FUNCTION: <name>
FILE: <path> | CLASS: <name>
FILE: <path> | CLASS: <ClassName> | METHOD: <methodName>
FILE: <path> | INTERFACE: <name>
FILE: <path> | TYPE: <name>
FILE: <path> | CONST: <name>
```

Each chunk body is the exact source slice for that AST node, prefixed with the line above and a blank line (mirrors existing `FILE: …\n\n` pattern in `chunkFile`).

For symbols exceeding `maxChars` (2000), split using existing `chunkFile` logic on the prefixed text (reuse `chunkFile`, do not reimplement).

## Grammar Selection by Extension

| Extensions | WASM grammar |
|---|---|
| `.ts` | `tree-sitter-typescript.wasm` |
| `.tsx` | `tree-sitter-tsx.wasm` |
| `.js`, `.mjs`, `.cjs`, `.jsx` | `tree-sitter-javascript.wasm` |

One TS grammar does **not** cover plain `.js` — use `tree-sitter-javascript` for JS extensions (already present as transitive dep of `tree-sitter-typescript`).

## Fallback Rules

| Condition | Behavior |
|---|---|
| Empty/whitespace content | Return `[]` (same as `chunkFile`) |
| Parse throws | Fall back to `rawTextStrategy` / `chunkFile` — never throw to caller |
| `rootNode.hasError` (partial parse) | **Still use extracted symbols** if any; supplement with raw fallback only when zero symbols extracted |
| Zero extractable top-level symbols | Fall back to `chunkFile` (e.g. re-export-only barrels, data-only files) |
| WASM runtime not initialized yet | Fall back to `chunkFile` (shell must call async init before sync/setup) |

## Architecture: Async Init vs Pure Core

`Parser.init()` and `Language.load()` are **async**. `ChunkingStrategy` is **sync**.

**Resolution for Task 14:**

1. `src/core/tree-sitter-chunker.ts` — pure symbol extraction from `{ content, node ranges }` plus `treeSitterStrategy` that reads module-level initialized parser state
2. `export async function initTreeSitterChunker(): Promise<void>` in the same file (loads WASM once; no `node:fs` import — use `Language.load` with absolute paths passed from shell or resolved via `import.meta.url` in non-bundled dev mode)
3. `src/shell/sync.ts` / `src/cli.ts` — `await initTreeSitterChunker()` at the start of setup/sync paths when `chunking: tree-sitter`

If `initTreeSitterChunker()` was not called, `treeSitterStrategy` silently falls back to raw chunking (safe default).

## Files With Notable Spike Behavior

| File | Notes |
|---|---|
| `src/shell/viking-http.ts` | Partial parse (`hasError=true`) — likely complex template types; still produced symbols. Monitor in Task 14 tests. |
| Zero-symbol file (1/40 in benchmark) | Unidentified by path in spike output; fallback rule covers this class |

## Required Code Changes (Task 14–15)

1. Add production deps: `web-tree-sitter`, `tree-sitter-typescript`
2. Implement `src/core/tree-sitter-chunker.ts` + tests per plan Task 14
3. Add `selectChunkingStrategy()` to `src/core/chunker.ts`
4. Wire `config.defaults.chunking` in `sync.ts` + `cli.ts`; remove Task 10 fail-fast guard
5. Copy WASM assets in build script (follow-up within Task 14 or immediately after)

## STOP — Review Gate

This document satisfies Task 13's STOP requirement. Task 14 may proceed using the library choice, prefix format, and fallback rules above.
