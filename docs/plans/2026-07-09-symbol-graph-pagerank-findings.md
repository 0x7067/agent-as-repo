# Symbol Graph + PageRank — Findings

Date: 2026-07-09
Status: landed (core)
Depends on: `2026-07-09-symbol-refs-findings.md`, definition spike

## Goal

Build a directed dependency graph from definitions + TS/JS refs, then rank
symbols with damped PageRank (Aider repo-map lineage) so “important” symbols
surface for lookup / later core-memory summaries.

## What landed

| Piece | Location |
|-------|----------|
| Graph builder | `src/core/symbol-graph.ts` — `buildSymbolGraph`, `resolveRelativeModule` |
| PageRank | `src/core/symbol-pagerank.ts` — `pageRank`, `rankDefinitions` |
| Tests | Hand-built fixtures only (no WASM, no mocks) |

## Node / edge model

- **Definition nodes:** `def:<filePath>#<qualifiedName>@<startLine>`
- **File nodes:** `file:<filePath>` (import/call edges originate here)
- **Import edges:** importer file → resolved definition(s) in the target module
- **Call edges:** caller file → resolved definition(s)

## Resolution rules (v1)

| Case | Behavior |
|------|----------|
| Relative `./` / `../` specifier | Resolve against importer dir; try `.ts`/`.tsx`/`.js`/… and `/index.*` |
| Bare / `node:` packages | Skip — no package or `tsconfig` paths resolution |
| Named import | Match target def by name; honor export aliases |
| Default import | Prefer `default` export / first top-level non-METHOD def |
| Namespace `*` import | Edges to exported defs (or all defs if no export refs) |
| Same-file call | Prefer local defs |
| Imported binding call | Follow binding → target def |
| `obj.method()` + namespace/class import | Resolve method on target file |
| Ambiguous bare name | Edges to **all** `findDefinitions` hits (over-connect) |

## PageRank

- Damping **0.85**, max **50** iterations, L1 tolerance **1e-8**
- Dangling nodes redistribute mass uniformly
- Scores sum to ~1 over all nodes
- `rankDefinitions` filters to `def:` nodes, sorted descending

Inbound edges from many importers/callers raise a symbol’s score — the same
signal Aider uses to pick repo-map context.

## Limits

- File-level call edges (not caller-function → callee); fine for ranking, weaker for “who calls X inside Y”
- Default-export matching is heuristic
- Bare package imports (e.g. `lodash`) still skipped — no `node_modules` resolution
- Go module-path → directory mapping not yet implemented

## Follow-up (landed in same effort)

Sync-time `symbolFiles` / `symbolRanks` + CLI `find_symbol` behind
`agenticTools` (no MCP symbol tools). Later commits also added Python/Go refs,
tsconfig path aliases, and PageRank evidence in consolidate prompts — see
`2026-07-09-repo-map-followups-findings.md`.
