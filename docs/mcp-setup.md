# Exposing repo-expert Agents via MCP

This repo includes a built-in MCP server (`src/mcp-server.ts`) that exposes 8 tightly-typed tools over stdio. No external packages needed beyond `tsx` (dev dependency).

## Why this wrapper exists

Hub-style MCP servers expose tools where a single `operation` string param multiplexes many actions, with everything else optional. LLMs routinely get the required params wrong. This wrapper exposes **individual tools with strict schemas** — `agent_id` is required where needed, not optional.

## Prerequisites

- An OpenAI-compatible chat endpoint — local [Ollama](https://ollama.com) by default, or a remote endpoint (e.g. OpenRouter) with `LLM_API_KEY` set — serving both the chat model and the embedding model (default `nomic-embed-text`)
- `tsx` installed (already a dev dependency of this repo)

## Configure for Claude Code

Add to `~/.claude.json` under the top-level `mcpServers` key (global, all projects):

```json
{
  "mcpServers": {
    "repo-expert": {
      "command": "npx",
      "args": ["tsx", "/path/to/agent-as-repo/src/mcp-server.ts"],
      "timeout": 300,
      "env": {
        "LLM_MODEL": "qwen3-coder:30b",
        "LLM_BASE_URL": "http://localhost:11434/v1",
        "LLM_EMBEDDING_MODEL": "nomic-embed-text"
      }
    }
  }
}
```

Or per-project in `.mcp.json` (same format inside `"mcpServers"`).

`pnpm repo-expert mcp-install` generates this entry for you (reading `config.yaml` if present) — see below.

## Configure for Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.repo-expert]
command = "npx"
args = ["tsx", "/path/to/agent-as-repo/src/mcp-server.ts"]
tool_timeout_sec = 300

[mcp_servers.repo-expert.env]
LLM_MODEL = "qwen3-coder:30b"
LLM_BASE_URL = "http://localhost:11434/v1"
LLM_EMBEDDING_MODEL = "nomic-embed-text"
```

## Configure for Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "repo-expert": {
      "command": "npx",
      "args": ["tsx", "/path/to/agent-as-repo/src/mcp-server.ts"],
      "env": {
        "LLM_MODEL": "qwen3-coder:30b",
        "LLM_BASE_URL": "http://localhost:11434/v1",
        "LLM_EMBEDDING_MODEL": "nomic-embed-text"
      }
    }
  }
}
```

## Generate the entry automatically

```bash
pnpm repo-expert mcp-install  # writes/overwrites the "repo-expert" entry in ~/.claude.json
pnpm repo-expert mcp-check    # validates the existing entry
```

Both commands read `config.yaml` (if present) for `model`, `base_url`, and `embedding_model`, and pull `LLM_API_KEY` from the environment.

## Environment variables

| Variable | Purpose |
|---|---|
| `LLM_MODEL` | Chat model id (default `qwen3-coder:30b`) |
| `LLM_BASE_URL` | OpenAI-compatible LLM endpoint (default `http://localhost:11434/v1`) |
| `LLM_API_KEY` | Optional Bearer token for the LLM endpoint. Needed for remote endpoints (e.g. OpenRouter); local Ollama needs none |
| `LLM_EMBEDDING_MODEL` | Embedding model id served by the same endpoint (default `nomic-embed-text`) |
| `REPO_EXPERT_DATA_DIR` | Directory for the embedded store DB (default `~/.repo-expert`) |
| `LLM_FALLBACK_MODELS` | Comma-separated fallback model list |
| `LLM_REQUEST_TIMEOUT_MS` | Per-request LLM timeout (default 20000) |
| `LLM_MAX_RETRIES_PER_MODEL` | Retries per model before falling back (default 1) |
| `LLM_RETRY_BASE_DELAY_MS` | Base delay for retry backoff (default 600) |
| `REPO_EXPERT_ASK_TIMEOUT_MS` | Default timeout for `agent_call` when `timeout_ms` isn't passed per-call (default 60000) |

## Available Tools

| Tool | Params | Description |
|------|--------|-------------|
| `agent_list` | _(none)_ | List all repo-expert agents |
| `agent_get` | `agent_id` | Full agent details including memory blocks |
| `agent_call` | `agent_id`, `content`, `override_model?`, `timeout_ms?`, `max_steps?` | Send a message to an agent and get the response |
| `agent_get_core_memory` | `agent_id` | Get all memory blocks (`{label, value, limit}`) for an agent |
| `agent_search_archival` | `agent_id`, `query`, `top_k?` | Semantic search over archival passages |
| `agent_insert_passage` | `agent_id`, `text` | Insert a passage into archival memory |
| `agent_delete_passage` | `agent_id`, `passage_id` | Delete a passage. To update, delete then insert |
| `agent_update_block` | `agent_id`, `label`, `value` | Overwrite a memory block's value |

Call `agent_list` first to discover agent IDs, then pass an `agent_id` to the other tools. Agent IDs are plain repo names — there is no provider namespacing.

## Verify

```bash
# MCP handshake
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' \
  | npx tsx src/mcp-server.ts
```

Should return `serverInfo: { name: "repo-expert-mcp" }` with 8 tools.

## Troubleshooting

### Connection refused to the LLM endpoint

- Confirm Ollama (or your configured endpoint) is running and reachable at `LLM_BASE_URL` (default `http://localhost:11434/v1`), and that the models in `LLM_MODEL` and `LLM_EMBEDDING_MODEL` have been pulled
- Run `pnpm repo-expert doctor` for a full connectivity + config check

### "Authentication failed" or 401

- If you're pointed at a remote endpoint (e.g. OpenRouter), verify `LLM_API_KEY` is set in the `env` block of your MCP config (not just in `.env`) — MCP servers run as separate processes and don't inherit your shell's `.env` file
- Local Ollama requires no API key; a 401 there usually means the wrong `LLM_BASE_URL`

### Server fails to start / "Failed to reconnect"

- Use `npx tsx`, not bare `tsx`. Bare `tsx` may not be on `PATH` in the MCP subprocess environment
- Verify the path to `src/mcp-server.ts` is absolute
- Test manually: `npx tsx src/mcp-server.ts` — should hang waiting for stdin (that's correct)

### Agents not found

Run `pnpm repo-expert list` to confirm agents exist, or use the MCP handshake above.

### Timeouts

Agent responses can take 30s+ for complex requests. Set `timeout: 300` (Claude Code) or `tool_timeout_sec = 300` (Codex).

### Per-project vs global config

Prefer **global** config (`~/.claude.json` top-level `mcpServers`, `~/.codex/config.toml`) so the tools are available in every project. Per-project configs (`.mcp.json`, worktree-specific) lead to duplicated entries that drift out of sync.
