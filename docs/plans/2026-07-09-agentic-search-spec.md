# Agentic Search Spec

Date: 2026-07-09
Status: landed
Depends on: hybrid BM25+vector search (`docs/plans/2026-07-05-hybrid-search-spec.md`)

## Why

RAG is not just vector search. Agents need iterative tools (ripgrep, glob, file
read) plus hybrid recall and path filters so they can stage-narrow large
codebases. Semantic indexing stays; vector search becomes a recall booster.

## Design

### Agent tools (`LocalProvider.sendMessage`)

| Tool | Role |
|------|------|
| `grep_repo` | Live ripgrep over the repo (`buildRipgrepArgs` + `execFileSync`) |
| `glob_files` | Live glob filtered by `shouldIncludeFile` |
| `read_file` | Safe relative read (`resolveSafeRepoPath` + size cap) |
| `archival_memory_search` | Hybrid BM25+vector; optional `path_prefix` |
| `memory_replace` | Unchanged |

Repo access is injected via `RepoAccessPort` (`createRepoAccess` from
`config.repos`). CLI always wires it; MCP loads `config.yaml` /
`REPO_EXPERT_CONFIG` when present and degrades agentic tools with a clear
error when missing.

### Path-scoped hybrid search

`PassageStore.semanticSearch(agentId, query, limit, { pathPrefix? })` filters
both vector and FTS legs with `file_path LIKE prefix%`.

### Content-hash skip (Merkle-inspired, not a full Merkle tree)

`AgentState.fileHashes` stores SHA-256 of file content. `syncRepo` skips
re-chunk/re-embed when the hash is unchanged. Setup seeds hashes on first
index.

## Deferred

- Full Merkle trees
- Tree-sitter symbol / PageRank repo map
- Cross-encoder reranker
- Direct MCP tools for grep/read (agents already get them via `agent_call`)
