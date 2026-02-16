# Exposing Repo Expert Agents via MCP

This guide explains how to make your repo-expert agents accessible to AI tools (Claude Code, Cursor, etc.) through the [Letta MCP Server](https://github.com/oculairmedia/Letta-MCP-server).

## Prerequisites

- Repo-expert agents created via `repo-expert setup`
- Letta Cloud API key (`LETTA_API_KEY` in `.env`)

## Install Letta MCP Server

```bash
npm install -g letta-mcp-server
```

## Configure for Claude Code

Add to your `~/.claude/settings.json` or project `.claude/settings.json`:

```json
{
  "mcpServers": {
    "letta": {
      "command": "letta-mcp",
      "args": [],
      "env": {
        "LETTA_BASE_URL": "https://api.letta.com/v1",
        "LETTA_PASSWORD": "<your LETTA_API_KEY>"
      }
    }
  }
}
```

## Configure for Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "letta": {
      "command": "letta-mcp",
      "env": {
        "LETTA_BASE_URL": "https://api.letta.com/v1",
        "LETTA_PASSWORD": "<your LETTA_API_KEY>"
      }
    }
  }
}
```

## Helper Script

Generate the MCP config automatically:

```bash
pnpm tsx scripts/generate-mcp-config.ts
```

This reads your `.env` file and outputs the JSON config block ready to paste.

## Usage

Once configured, your AI tool can:

- **List agents**: discover all repo-expert agents
- **Prompt agents**: ask questions about any indexed repo
- **Read memory**: inspect agent core memory blocks
- **Search passages**: query the agent's archival memory directly

## Agent Discovery

All repo-expert agents are tagged with `["repo-expert", ...repoTags]`. Use these tags to find the right agent:

| Tag Pattern | Meaning |
|---|---|
| `repo-expert` | All repo-expert agents |
| `repo-expert` + `frontend` | Frontend repo agents |
| `repo-expert` + `backend` | Backend repo agents |

## Troubleshooting

- **"Connection refused"**: Ensure `letta-mcp` is installed globally and accessible in PATH
- **"Authentication failed"**: Verify `LETTA_PASSWORD` matches your `LETTA_API_KEY`
- **Agents not found**: Run `repo-expert list` to confirm agents exist
