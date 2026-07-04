# repo-expert

Persistent AI agents that act as long-term memory for your git repositories. Unlike IDE tools that forget between sessions, these agents accumulate knowledge over time and answer questions about your codebase instantly.

Single path: an embedded sqlite-vec store for passages and semantic search + any OpenAI-compatible chat endpoint, defaulting to a local [Ollama](https://ollama.com) server. The whole stack is two processes: this CLI and Ollama. Everything runs locally by default; point `base_url` at a remote endpoint (e.g. OpenRouter) if you'd rather not run a local model.

## Prerequisites

- [Ollama](https://ollama.com) running locally with a chat model pulled (default config expects `qwen3-coder:30b`) and an embedding model pulled (default `nomic-embed-text`, e.g. `ollama pull nomic-embed-text`)
- Node.js 22 (see `.nvmrc`; better-sqlite3's native addon is ABI-locked to this major) and pnpm

## Quickstart

1. **Install dependencies**
   ```bash
   pnpm install
   ```

2. **Generate `config.yaml`**
   ```bash
   pnpm repo-expert init
   ```
   Prompts for a chat model and LLM base URL (both default to local Ollama), then scans a repo and writes `config.yaml`.

3. **Create agents and index your repo**
   ```bash
   pnpm repo-expert setup
   ```

4. **Ask questions**
   ```bash
   pnpm repo-expert ask my-app "Where is authentication handled?"
   ```

## MCP Server

Expose agents to Claude Code, Cursor, or Codex via MCP (8 typed tools: `agent_list`, `agent_get`, `agent_call`, `agent_get_core_memory`, `agent_search_archival`, `agent_insert_passage`, `agent_delete_passage`, `agent_update_block`). See [docs/mcp-setup.md](docs/mcp-setup.md) for configuration.

```bash
pnpm repo-expert mcp-install  # writes the "repo-expert" entry to ~/.claude.json
```

## Command Reference

| Command | Description |
|---------|-------------|
| `init` | Interactive setup: pick model + LLM base URL, scan a repo, generate `config.yaml` |
| `setup [--repo] [--reindex] [--no-bootstrap]` | Create agents from `config.yaml`, load file passages, bootstrap |
| `ask <repo> <question> [--fast] [--fast-model <id>]` | Ask a single agent a question; `--fast` uses `provider.fast_model` (or `--fast-model`) |
| `ask --all <question>` | Broadcast question to all agents and collect responses |
| `sync [--repo] [--full]` | Sync file changes to agents via `git diff` |
| `reconcile [--repo] [--fix]` | Compare local passage state vs the provider, detect and fix drift |
| `list [--json] [--live]` | List all agents with passage counts |
| `status [--repo]` | Show agent memory stats and health |
| `consolidate [--repo]` | Rewrite the architecture/conventions memory blocks via the LLM (manual run; also runs post-sync when `consolidate_on_sync` is enabled) |
| `export [--repo]` | Export agent memory to markdown |
| `onboard <repo>` | Guided codebase walkthrough for new developers |
| `destroy [--repo] [--force] [--dry-run]` | Delete agents |
| `watch [--repo] [--interval] [--debounce]` | Poll git HEAD and auto-sync on new commits |
| `install-daemon` | Install launchd daemon for auto-sync on macOS |
| `uninstall-daemon` | Remove the launchd watch daemon |
| `mcp-install [--global\|--local]` | Write MCP server entry to Claude Code config |
| `mcp-check [--json]` | Validate existing MCP server entry |
| `config lint [--json]` | Validate `config.yaml` structure and semantics |
| `doctor [--fix] [--json] [--strict]` | Check config, LLM endpoint reachability, passage store, repo paths, git, state consistency; `--strict` promotes warnings to failures (non-zero exit) |
| `self-check [--json]` | Check local runtime/toolchain health (Node, pnpm, dependencies) |
| `completion <shell>` | Print shell completion script (bash, zsh, fish) |

## Configuration

Copy `config.example.yaml` to `config.yaml`. A complete config is three fields — everything else is optional with sensible defaults:

```yaml
provider:
  model: qwen3-coder:30b

repos:
  my-app:
    path: ~/repos/my-app
    description: "React Native mobile app"
```

Optional provider fields: `base_url` (default: local Ollama), `embedding_model` (default `nomic-embed-text`), `fast_model` (used by `ask --fast`), `fallback_models`. Optional repo fields: `extensions` and `ignore_dirs` (defaults cover common code/doc extensions and junk dirs), `persona`, `base_path` (monorepo subtree), `include_submodules`. A top-level `consolidate_on_sync: true` enables post-sync memory consolidation. Unknown keys are rejected, so typos fail loudly instead of being ignored.

To use a remote endpoint (e.g. OpenRouter) instead of local Ollama, set `base_url` and provide `LLM_API_KEY` in `.env`:

```yaml
provider:
  model: openai/gpt-4o-mini
  base_url: https://openrouter.ai/api/v1
```

Embeddings for archival search come from the same OpenAI-compatible endpoint (`POST {base_url}/embeddings`), using `provider.embedding_model` (default `nomic-embed-text`). Passages, vectors, and memory blocks live in one local SQLite database at `~/.repo-expert/store.db` (override the directory with `REPO_EXPERT_DATA_DIR`).

### Memory consolidation

The agent's `architecture`/`conventions` memory blocks can improve over time instead of staying frozen at bootstrap. Run `repo-expert consolidate [--repo]` for a one-off refresh, or set `consolidate_on_sync: true` to run it automatically after any `sync` (and `watch`, which calls sync) that touches at least 5 files. Consolidation runs one restricted LLM turn that may only rewrite the architecture/conventions blocks — the persona block is never touched — and it is non-fatal: if it fails or returns nothing usable, the old blocks are kept and the sync still succeeds.

### Environment variables (`.env`)

| Variable | Purpose |
|---|---|
| `LLM_API_KEY` | Optional Bearer token for the LLM endpoint. Required in practice only for remote endpoints (e.g. OpenRouter); local Ollama needs none. |
| `LLM_REQUEST_TIMEOUT_MS` | Per-request timeout for LLM calls (default 20000). |
| `LLM_MAX_RETRIES_PER_MODEL` | Retries per model before falling back (default 1). |
| `LLM_RETRY_BASE_DELAY_MS` | Base delay for retry backoff (default 600). |
| `LLM_FALLBACK_MODELS` | Comma-separated fallback model list (MCP server only; CLI uses `config.provider.fallback_models`). |
| `REPO_EXPERT_DEBUG_LLM` | Set to log LLM request/response debug info. |
| `REPO_EXPERT_ASK_TIMEOUT_MS` | Timeout for MCP `agent_call` when not overridden per-call. |
| `REPO_EXPERT_DATA_DIR` | Directory for the embedded store DB (default `~/.repo-expert`). |
| `LLM_EMBEDDING_MODEL` | Embedding model id (MCP server only; CLI uses `config.provider.embedding_model`). |

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full architecture diagram and design decisions.

Key points:
- **Functional core, imperative shell** — `src/core/` contains pure functions, `src/shell/` handles all I/O
- **Provider abstraction** — `AgentProvider` (`src/ports/agent-provider.ts`) and `PassageStore` (`src/ports/passage-store.ts`) interfaces decouple business logic from the store/LLM implementation
- **Three-tier memory** — core (always in context), archival (vector-searchable source files), recall (conversation history)
- **Symbol-aware chunking** — TypeScript/JavaScript/Python/Go/Java/Ruby are chunked at function/class boundaries via tree-sitter; other file types fall back to ~2KB text splits
- **Incremental sync** — `git diff` detects changes; only affected passages are re-indexed

## Development

```bash
pnpm install              # install dependencies
pnpm test                 # run all tests (vitest)
pnpm repo-expert --help   # CLI entry point
pnpm mcp-server           # start MCP server (stdio)
```

Conventions:
- TypeScript strict mode, ES2022 target
- TDD: write failing tests first, then implement
- Core modules (`src/core/`) have no side effects and require no mocks in tests
- Shell modules (`src/shell/`) mock external boundaries (LLM endpoint, filesystem); the sqlite store is exercised against real temp-file DBs in contract tests
- Package manager: pnpm (never npm or yarn)
