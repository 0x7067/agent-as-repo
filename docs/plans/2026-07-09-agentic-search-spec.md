# Agentic Search Spec

Date: 2026-07-09
Status: landed
Depends on: hybrid BM25+vector search (`docs/plans/2026-07-05-hybrid-search-spec.md`)

## Why

RAG is not just vector search. Standalone CLI ask needs iterative live-repo
tools; under coding harnesses (Claude Code / Cursor / Codex) those tools are
redundant — the host already has grep/glob/read. The MCP surface stays a
**memory layer**: core blocks + hybrid archival recall.

## Surface split

| Surface | Tools |
|---------|--------|
| **CLI `ask`** (`agenticTools: true`) | `grep_repo`, `glob_files`, `read_file`, `archival_memory_search`, `memory_replace` |
| **MCP / `agent_call`** (default) | `archival_memory_search`, `memory_replace` only |

Persisted persona stays harness-friendly. CLI ask appends ephemeral
`agenticSearchGuidance()` to the system prompt when live tools are enabled.

## Design

### Path-scoped hybrid search

`PassageStore.semanticSearch(agentId, query, limit, { pathPrefix? })` filters
both vector and FTS legs with `file_path LIKE prefix%`. Available on both
surfaces via `archival_memory_search.path_prefix`.

### Content-hash skip (Merkle-inspired, not a full Merkle tree)

`AgentState.fileHashes` stores SHA-256 of file content. `syncRepo` skips
re-chunk/re-embed when the hash is unchanged. Setup seeds hashes on first
index.

### Live-repo tools (CLI only)

| Tool | Role |
|------|------|
| `grep_repo` | Live ripgrep (`buildRipgrepArgs` + `execFileSync`) |
| `glob_files` | Live glob filtered by `shouldIncludeFile` |
| `read_file` | Safe relative read (`resolveSafeRepoPath` + size cap) |

Wired via `RepoAccessPort` / `createRepoAccess(config.repos)` when
`agenticTools: true`.

## Deferred

- Full Merkle trees
- Tree-sitter symbol / PageRank repo map
- Cross-encoder reranker
- Direct MCP tools for grep/read (host harness already provides these)
