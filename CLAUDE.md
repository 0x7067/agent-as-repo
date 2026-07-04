# CLAUDE.md — agent-as-repo

Global `~/.claude/CLAUDE.md` applies (think before coding, simplicity, surgical changes, goal-driven execution). This file adds project-specific rules.

## Architecture: Functional Core, Imperative Shell

- All business logic as pure functions — no I/O, no side effects, deterministic input/output
- Side effects (fs, network, sqlite/LLM calls, env vars) live in a thin shell at the boundary
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
- Shell tests: mock external boundaries (LLM endpoint, filesystem); sqlite store tests use real temp-file DBs

## Project Conventions

- Package manager: pnpm (never npm or yarn)
- Dev execution: `pnpm tsx <file>`
- Run CLI: `pnpm repo-expert <command>` (or `tsx src/cli.ts`)
- Run MCP server: `pnpm mcp-server` (or `tsx src/mcp-server.ts`)
- Run tests: `pnpm test` (vitest)
- TypeScript strict mode, ES2022 target
- Zod import: `import { z } from "zod/v4"` (not `"zod"` — project uses Zod v4 path)
- `archival_memory_search` and `memory_replace` are defined by the provider send loop itself — don't redefine them elsewhere
- Chunk files at ~2KB, split on `\n\n`, prefix with `FILE: <path>`
- Agent instructions live in the `persona` block — the local provider injects it into the system prompt; don't override the system prompt directly
- State persistence: `.repo-expert-state.json` (gitignored)
- API keys: `LLM_API_KEY` in `.env` (optional; only needed for remote LLM endpoints like OpenRouter — local Ollama needs none)
- Shell commands: always `execFileSync` with arg arrays, never `execSync` with template literals
- Any code path producing a file list must filter through `shouldIncludeFile` (extensions, ignoreDirs)
- Guard entry-point `main()` calls: `if (process.argv[1] === fileURLToPath(import.meta.url))`
- `Promise.race` with `setTimeout`: always store timer ID and `clearTimeout` in `finally`

## Key Files

- `src/cli.ts` — CLI entry point (commander-based, all subcommands)
- `src/mcp-server.ts` — MCP server entry point
- `src/ports/agent-provider.ts` — `AgentProvider` interface (all provider calls go through this)
- `src/ports/passage-store.ts` — `PassageStore` interface (passage persistence + semantic search)
- `src/shell/llm-client.ts` — OpenAI-compatible chat-completions/embeddings client + tool-calling loop
- `src/shell/sqlite-store.ts` — embedded better-sqlite3 + sqlite-vec passage store (`~/.repo-expert/store.db`)
- `src/core/types.ts` — Shared type definitions
- `config.yaml` — Repo configuration (gitignored)

## Pre-PR Checklist

1. All tests green (`pnpm test`)
2. No business logic with side effects — pure functions in core
3. No mocks in core tests
4. Every new function has a colocated test
5. LLM/store calls match the conventions in `src/shell/llm-client.ts` and `src/shell/sqlite-store.ts` (no ad hoc HTTP or SQL elsewhere)
6. No duplicated rules from global CLAUDE.md
