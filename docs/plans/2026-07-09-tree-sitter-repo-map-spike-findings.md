# Tree-sitter Repo Map Spike — Findings

Date: 2026-07-09
Status: landed (definition + TS/JS refs + graph/PageRank + sync `symbolFiles` + CLI `find_symbol`; MCP symbol tools out of scope)
Depends on: tree-sitter chunking (`src/core/tree-sitter-chunker.ts`)

## Goal

Prove existing definition spans can power **symbol lookup** without PageRank,
imports, or callers — and document the path to a full Aider-style repo map.

## What landed in this spike

| Piece | Location |
|-------|----------|
| Flat symbol index | `src/core/symbol-index.ts` — `buildSymbolIndex`, `findDefinitions`, `listSymbolsInFile` |
| Extract helper | `extractSymbolSpansFromFile` + exported `grammarLabelForPath` on the chunker |
| Tests | `src/core/symbol-index.test.ts` (pure; no WASM) |

**Not landed:** import/export edges, call graph, PageRank, sqlite persistence, CLI/MCP tools.

## Baseline (what tree-sitter already gives)

Definition `SymbolSpan`s for 13 languages: FUNCTION, CLASS, INTERFACE, TYPE, CONST,
METHOD, ENUM, MODULE, STRUCT, TRAIT. Used today only for chunk boundaries +
`FILE: … | KIND: name` prefixes. Imports fall into residue; no call sites.

## Product alignment

Product plan §5 item 2 wants a **dependency graph + PageRank** for “what calls X /
what breaks if I change Y.” This spike delivers the **definition layer** that
graph would hang off of. PageRank on definition-only nodes would be meaningless.

## Recommended follow-ups

1. **PR2 — reference extraction (TS/JS first):** `import` / `call_expression` → edges
2. **PR3 — graph + PageRank:** pure core ranking; feed core-memory summaries
3. **PR4 — `find_symbol` CLI tool** (and optional MCP) wired through sync + content-hash invalidation

## Integration options (for later)

| Option | Notes |
|--------|-------|
| A. Build at sync time | Best fit with `fileHashes`; invalidate per changed file |
| B. On-demand CLI | Simpler; re-parse on each ask |
| C. Sqlite side table | Heavier; only if index must survive across processes without state file |

Recommend **A** once reference extraction exists.

## Risks

- Ambiguous bare names (`foo` in many files) — callers should prefer qualified names / pathPrefix
- Go method receivers / C++ declarators already special-cased in extractors; keep using them
- Kotlin/Swift grammar fidelity for anything beyond definitions remains weaker
