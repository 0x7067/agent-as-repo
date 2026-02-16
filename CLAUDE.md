# CLAUDE.md — agent-as-repo

Global `~/.claude/CLAUDE.md` applies (think before coding, simplicity, surgical changes, goal-driven execution). This file adds project-specific rules.

## Architecture: Functional Core, Imperative Shell

- All business logic as pure functions — no I/O, no side effects, deterministic input/output
- Side effects (fs, network, Letta SDK, env vars) live in a thin shell at the boundary
- When unsure where code belongs: "Can this function run without touching the outside world?" Yes → core. No → push the effect outward.
- Core modules import nothing from the shell. The shell imports from the core.
- `src/core/` for pure logic, `src/shell/` for I/O and integration

## Workflow: TDD Red-Green

- Every feature or fix starts with a failing test (red)
- Write minimum code to pass (green)
- No production code without a corresponding test
- Run `pnpm test` before committing; red suite blocks the commit
- Test framework: vitest
- Colocated test files: `foo.ts` → `foo.test.ts` (same directory)
- Core tests: no mocks needed (pure functions)
- Shell tests: mock external boundaries (Letta SDK, filesystem)

## Project Conventions

- Package manager: pnpm (never npm or yarn)
- Dev execution: `pnpm tsx <file>`
- Run CLI: `pnpm repo-expert <command>` (or `tsx src/cli.ts`)
- Run MCP server: `pnpm mcp-server` (or `tsx src/mcp-server.ts`)
- Run tests: `pnpm test` (vitest)
- TypeScript strict mode, ES2022 target
- Letta SDK import: `import { Letta } from "@letta-ai/letta-client"` (not LettaClient)
- Zod import: `import { z } from "zod/v4"` (not `"zod"` — project uses Zod v4 path)
- Always attach `archival_memory_search` tool explicitly to agents
- Chunk files at ~2KB, split on `\n\n`, prefix with `FILE: <path>`
- Never override Letta system prompt — use `persona` block for agent instructions
- State persistence: `.repo-expert-state.json` (gitignored)
- API key: `LETTA_API_KEY` in `.env`

## Key Files

- `src/cli.ts` — CLI entry point (commander-based, all subcommands)
- `src/mcp-server.ts` — MCP server entry point
- `src/shell/provider.ts` — `AgentProvider` interface (all Letta SDK calls go through this)
- `src/core/types.ts` — Shared type definitions
- `config.yaml` — Repo configuration (gitignored)

## Pre-PR Checklist

1. All tests green (`pnpm test`)
2. No business logic with side effects — pure functions in core
3. No mocks in core tests
4. Every new function has a colocated test
5. Letta SDK patterns match `memory/letta-sdk.md` signatures
6. No duplicated rules from global CLAUDE.md
