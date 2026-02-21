# repo-expert

Persistent AI agents that act as long-term memory for your git repositories. Unlike IDE tools that forget between sessions, these agents accumulate knowledge over time and answer questions about your codebase instantly.

## Quickstart

1. **Install dependencies**
   ```bash
   pnpm install
   ```

2. **Configure API key and generate `config.yaml`**
   ```bash
   pnpm repo-expert init
   ```

3. **Create agents and index your repo**
   ```bash
   pnpm repo-expert setup
   ```

4. **Ask questions**
   ```bash
   pnpm repo-expert ask my-app "Where is authentication handled?"
   ```

## MCP Server

Expose Letta agents to Claude Code, Cursor, or Codex via MCP (8 typed tools). See [docs/mcp-setup.md](docs/mcp-setup.md) for configuration.

```bash
pnpm repo-expert mcp-install  # writes entry to ~/.claude.json
```

## Command Reference

| Command | Description |
|---------|-------------|
| `init` | Interactive setup: configure API key, scan a repo, generate `config.yaml` |
| `setup [--repo] [--reindex]` | Create agents from `config.yaml`, load file passages, bootstrap |
| `ask <repo> <question>` | Ask a single agent a question |
| `ask --all <question>` | Broadcast question to all agents and collect responses |
| `sync [--repo] [--full]` | Sync file changes to agents via `git diff` |
| `reconcile [--repo] [--fix]` | Compare local passage state vs Letta, detect and fix drift |
| `list [--json]` | List all agents with passage counts |
| `status [--repo]` | Show agent memory stats and health |
| `export [--repo]` | Export agent memory to markdown |
| `onboard <repo>` | Guided codebase walkthrough for new developers |
| `destroy [--repo] [--force]` | Delete agents from Letta Cloud |
| `sleeptime [--repo]` | Enable sleep-time memory consolidation on existing agents |
| `watch [--repo] [--interval]` | Poll git HEAD and auto-sync on new commits |
| `install-daemon` | Install launchd daemon for auto-sync on macOS |
| `uninstall-daemon` | Remove the launchd watch daemon |
| `mcp-install [--global\|--local]` | Write MCP server entry to Claude Code config |
| `mcp-check` | Validate existing MCP server entry |
| `config lint` | Validate `config.yaml` structure and semantics |
| `doctor [--fix]` | Check API key, config, repo paths, git, state consistency |
| `self-check` | Check local runtime/toolchain health (Node, pnpm, dependencies) |
| `completion <shell>` | Print shell completion script (bash, zsh, fish) |

## Configuration

Copy `config.example.yaml` to `config.yaml` and set `LETTA_API_KEY` in `.env`:

```yaml
letta:
  model: openai/gpt-4.1
  embedding: openai/text-embedding-3-small

repos:
  my-app:
    path: ~/repos/my-app
    description: "React Native mobile app"
    extensions: [.ts, .tsx, .js, .json]
    ignore_dirs: [node_modules, .git, dist]
```

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full architecture diagram and design decisions.

Key points:
- **Functional core, imperative shell** — `src/core/` contains pure functions, `src/shell/` handles all I/O
- **Provider abstraction** — `AgentProvider` interface decouples business logic from the Letta SDK
- **Three-tier memory** — core (always in context), archival (vector-searchable source files), recall (conversation history)
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
- Shell modules (`src/shell/`) mock external boundaries (Letta SDK, filesystem)
- Package manager: pnpm (never npm or yarn)
