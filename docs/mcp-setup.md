# Exposing Letta Agents via MCP

This repo includes a built-in MCP server (`src/mcp-server.ts`) that exposes 8 tightly-typed Letta tools over stdio. No external packages needed beyond `tsx` (dev dependency).

## Why this wrapper exists

The official `letta-mcp` server exposes hub-style tools where a single `operation` string param multiplexes many actions, with everything else optional. LLMs routinely get the required params wrong. This wrapper exposes **individual tools with strict schemas** — `agent_id` is required where needed, not optional.

## Prerequisites

- Letta Cloud API key (`LETTA_API_KEY`)
- `tsx` installed (already a dev dependency of this repo)

## Configure for Claude Code

Add to `~/.claude.json` under the top-level `mcpServers` key (global, all projects):

```json
{
  "mcpServers": {
    "letta": {
      "command": "npx",
      "args": ["tsx", "/path/to/agent-as-repo/src/mcp-server.ts"],
      "timeout": 300,
      "env": {
        "LETTA_BASE_URL": "https://api.letta.com",
        "LETTA_API_KEY": "<your key>"
      }
    }
  }
}
```

Or per-project in `.mcp.json` (same format inside `"mcpServers"`).

## Configure for Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.letta]
command = "npx"
args = ["tsx", "/path/to/agent-as-repo/src/mcp-server.ts"]
tool_timeout_sec = 300

[mcp_servers.letta.env]
LETTA_BASE_URL = "https://api.letta.com"
LETTA_API_KEY = "<your key>"
```

Codex uses `LETTA_PASSWORD` as an alias for `LETTA_API_KEY` — the server accepts both.

## Configure for Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "letta": {
      "command": "npx",
      "args": ["tsx", "/path/to/agent-as-repo/src/mcp-server.ts"],
      "env": {
        "LETTA_BASE_URL": "https://api.letta.com",
        "LETTA_API_KEY": "<your key>"
      }
    }
  }
}
```

## Available Tools

| Tool | Params | Description |
|------|--------|-------------|
| `letta_list_agents` | _(none)_ | List all agents |
| `letta_get_agent` | `agent_id` | Full agent details |
| `letta_send_message` | `agent_id`, `content` | Send message, get response |
| `letta_get_core_memory` | `agent_id` | All memory blocks |
| `letta_search_archival` | `agent_id`, `query`, `top_k?` | Semantic passage search |
| `letta_insert_passage` | `agent_id`, `text` | Insert into archival memory |
| `letta_delete_passage` | `agent_id`, `passage_id` | Delete a passage |
| `letta_update_block` | `agent_id`, `label`, `value` | Update a memory block |

## Bring Your Own Key (BYOK)

By default, agents use Letta-managed model providers (e.g. `openai/gpt-4.1`), which are billed through your Letta Cloud subscription. You can register your own LLM provider API keys in Letta Cloud so that requests are billed directly by the provider instead.

### Register a provider key

1. Go to the [Letta Cloud models page](https://app.letta.com/models)
2. Click "Add your own LLM API keys" and connect a provider (OpenAI, Anthropic, Z.ai, ChatGPT Plus, etc.)
3. Note the provider handle that appears (e.g. `chatgpt-plus-pro`, `lc-zai`)

### Use BYOK models in config.yaml

Set the `model` field to a handle from your BYOK provider, not the managed provider:

```yaml
letta:
  # Letta-managed (billed through Letta):
  # model: openai/gpt-4.1

  # BYOK (billed directly by provider):
  model: chatgpt-plus-pro/gpt-5.1
```

Run `repo-expert setup` to create new agents with the BYOK model. Existing agents keep their old model until you re-create them or update via the Letta API.

Not every model listed under a BYOK provider will work — some providers only support a subset. List the models available for your provider before choosing:

```bash
# List models for a specific BYOK provider (replace with your handle)
PROVIDER=chatgpt-plus-pro
curl -s -H "Authorization: Bearer $LETTA_API_KEY" \
  "https://api.letta.com/v1/models" \
  | python3 -c "
import json, sys, os
prefix = os.environ['PROVIDER'] + '/'
for m in json.load(sys.stdin):
    h = m.get('handle', '')
    if h.startswith(prefix):
        print(h)
"
```

Replace `chatgpt-plus-pro` with your provider handle (e.g. `lc-zai`). Models under `openai/`, `anthropic/`, etc. (without your provider prefix) use Letta's managed keys and are billed through Letta.

## Verify

```bash
# MCP handshake
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' \
  | LETTA_BASE_URL=https://api.letta.com LETTA_API_KEY=<your-key> npx tsx src/mcp-server.ts
```

Should return `serverInfo: { name: "letta-tools" }` with 8 tools.

## Troubleshooting

### `404 {"detail":"Not Found"}`

**Most likely: double `/v1` in the base URL.** The `@letta-ai/letta-client` SDK appends `/v1` to all requests automatically. If you set `LETTA_BASE_URL=https://api.letta.com/v1`, the actual requests hit `https://api.letta.com/v1/v1/agents` → 404.

**Fix:** Use `https://api.letta.com` (no `/v1` suffix).

Quick check:
```bash
# This should return 200
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer <your-key>" \
  "https://api.letta.com/v1/agents"

# This returns 404 (double /v1)
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer <your-key>" \
  "https://api.letta.com/v1/v1/agents"
```

### "Authentication failed" or 401

- Verify `LETTA_API_KEY` is set in the `env` block of your MCP config (not just in `.env`)
- MCP servers run as separate processes — they don't inherit your shell's `.env` file
- For Codex, the env var can also be named `LETTA_PASSWORD` (the server accepts both)

### Server fails to start / "Failed to reconnect"

- Use `npx tsx`, not bare `tsx`. Bare `tsx` may not be on `PATH` in the MCP subprocess environment
- Verify the path to `src/mcp-server.ts` is absolute
- Test manually: `LETTA_BASE_URL=https://api.letta.com LETTA_API_KEY=<key> npx tsx src/mcp-server.ts` — should hang waiting for stdin (that's correct)

### Agents not found

Run `pnpm repo-expert list` to confirm agents exist, or use the MCP handshake above.

### Timeouts

Letta API calls can take 30s+ for complex agent responses. Set `timeout: 300` (Claude Code) or `tool_timeout_sec = 300` (Codex).

### Per-project vs global config

Prefer **global** config (`~/.claude.json` top-level `mcpServers`, `~/.codex/config.toml`) so the tools are available in every project. Per-project configs (`.mcp.json`, worktree-specific) lead to duplicated entries that drift out of sync.
