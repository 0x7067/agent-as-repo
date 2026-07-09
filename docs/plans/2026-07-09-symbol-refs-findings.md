# Symbol Reference Extraction — Findings

Date: 2026-07-09
Status: landed (TS/JS/TSX)
Depends on: definition-layer spike (`docs/plans/2026-07-09-tree-sitter-repo-map-spike-findings.md`)

## Goal

Extract structured **import / export / call** references from tree-sitter ASTs
for TypeScript, TSX, and JavaScript — separate from definition extractors — so
a dependency graph + PageRank can hang off the definition index.

## What landed

| Piece | Location |
|-------|----------|
| Ref types + guards | `src/core/symbol-refs.ts` — `ImportRef`, `ExportRef`, `CallRef` |
| JS/TS extractor | `src/core/tree-sitter-refs-js.ts` — `extractSymbolRefsJsTs` |
| Chunker bridge | `extractSymbolRefsFromFile` on `src/core/tree-sitter-chunker.ts` |
| Tests | `symbol-refs.test.ts`, `tree-sitter-refs-js.test.ts`, chunker bridge cases |

**Not landed (at refs PR):** graph edges, PageRank, sync persistence, `find_symbol` tool — graph/PageRank now in `2026-07-09-symbol-graph-pagerank-findings.md`.

## AST coverage (TS/JS)

| Construct | Status |
|-----------|--------|
| Default import | Yes (`imported: "default"`) |
| Named imports + `as` alias | Yes |
| Namespace `import * as` | Yes (`imported: "*"`) |
| `import type { … }` | Yes (same shape as value imports) |
| Declaration exports (`export function/const/class/…`) | Yes |
| `export { a as b } from` | Yes |
| `export * from` | Yes (`exported: "*"`) |
| Bare / member / `new` / nested calls | Yes |
| Dynamic `import()` | No (call site only if written as `import(…)`, not modeled as ImportRef) |
| `require()` | No (CommonJS not modeled) |
| Side-effect `import "./x"` | Module specifier captured with empty `importedNames` |
| Non-relative / package imports | Specifier recorded; resolution deferred to graph layer |

## Design notes

- Definition extraction (`extractSymbolSpansJsTs` / `tree-sitter-lang-*`) is
  untouched — refs live in a parallel module.
- `extractSymbolRefsFromFile` returns `[]` for non-JS/TS grammars (Python, Go, …).
- Call extraction walks the full tree; import/export only top-level statements
  (matches how ESM modules are structured).

## Next

1. Symbol graph + PageRank (import → symbol, call → definition)
2. Sync-time index + CLI `find_symbol` behind `agenticTools`
