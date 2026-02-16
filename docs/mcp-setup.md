# Exposing Letta Agents via MCP

This repo includes a built-in MCP server (`src/mcp-server.ts`) that exposes 8 tightly-typed Letta tools over stdio. No external packages needed.

## Prerequisites

- Letta Cloud API key (`LETTA_API_KEY`)
- `tsx` installed (already a dev dependency)

## Configure for Claude Code

Add to `~/.claude.json` (or project `.mcp.json`):

```json
{
  "mcpServers": {
    "letta": {
      "command": "tsx",
      "args": ["/path/to/agent-as-repo/src/mcp-server.ts"],
      "env": {
        "LETTA_BASE_URL": "https://api.letta.com/v1",
        "LETTA_API_KEY": "<your key>"
      }
    }
  }
}
```

## Configure for Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.letta]
command = "tsx"
args = ["/path/to/agent-as-repo/src/mcp-server.ts"]
tool_timeout_sec = 300

[mcp_servers.letta.env]
LETTA_BASE_URL = "https://api.letta.com/v1"
LETTA_API_KEY = "<your key>"
```

## Configure for Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "letta": {
      "command": "tsx",
      "args": ["/path/to/agent-as-repo/src/mcp-server.ts"],
      "env": {
        "LETTA_BASE_URL": "https://api.letta.com/v1",
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

## Verify

```bash
# MCP handshake
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | tsx src/mcp-server.ts
```

Should return `serverInfo: { name: "letta-tools" }` with 8 tools.

## Troubleshooting

- **"Authentication failed"**: Verify `LETTA_API_KEY` is set correctly in the env block
- **Agents not found**: Run `pnpm repo-expert list` to confirm agents exist
- **Timeouts**: Letta API calls can take 30s+; increase `tool_timeout_sec` in Codex or wait in Claude Code
