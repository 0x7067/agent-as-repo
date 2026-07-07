# Contributing to repo-expert

Thanks for taking a look. This is a small CLI + MCP server, and the bar for
contributions is: tests pass, the architecture rules below are respected, and
the change is scoped to what it says it does.

## Prerequisites

- **Node.js 22** (pinned in `.nvmrc`/`mise.toml`; `better-sqlite3`'s native
  addon is ABI-locked to this major, so other majors will fail to load it)
- **pnpm 10** (`packageManager` in `package.json` pins `10.20.0`) — never use
  npm or yarn in this repo, lockfile and `node-linker=hoisted` assume pnpm
- **[Ollama](https://ollama.com)** (optional) — only needed if you want to
  manually exercise the CLI/MCP server against a real LLM endpoint (`ollama
  pull qwen3-coder:30b` and `ollama pull nomic-embed-text`). All automated
  tests mock the LLM boundary and don't need it.

## Setup

```bash
pnpm install
```

`better-sqlite3` and `tree-sitter-cli` need to run native build scripts on
install. They're pre-approved via `onlyBuiltDependencies` in
`pnpm-workspace.yaml`, so a plain `pnpm install` should just work. If pnpm
ever prompts you about blocked build scripts (e.g. after upgrading pnpm, or
if you add a new native dependency), run:

```bash
pnpm approve-builds
```

and only approve packages that genuinely need a native build — see the
comment above `onlyBuiltDependencies` in `pnpm-workspace.yaml` for why
`tree-sitter-kotlin`/`tree-sitter-swift` are deliberately excluded.

## Dev commands

```bash
pnpm test                    # vitest, run this before every commit
pnpm lint                    # eslint (zero warnings allowed)
pnpm typecheck               # tsc --noEmit against tsconfig.typecheck.json
pnpm sanity                  # lint + typecheck + test, same gate CI runs
pnpm repo-expert <command>   # run the CLI from source via tsx (no build needed)
pnpm mcp-server               # run the MCP server from source via tsx
pnpm build                   # esbuild bundle to dist/bin/*.mjs (what CI/release smoke-test)
```

`repo-expert` is also runnable as `tsx src/cli.ts` directly if you want to
pass flags the `pnpm repo-expert` script wrapper might swallow.

## Architecture ground rules

This repo follows **functional core, imperative shell** — see
[`docs/architecture.md`](docs/architecture.md) for the full picture. In short:

- `src/core/` — pure functions only. No filesystem, network, sqlite, LLM
  calls, or `process.env` reads. If you're unsure where something belongs,
  ask "can this run without touching the outside world?" Yes → core, no →
  push the effect out to `src/shell/`.
- `src/shell/` — all I/O and integration adapters live here, behind the
  interfaces in `src/ports/`. Core modules never import from shell.
- `src/ports/` — `AgentProvider` and `PassageStore` are the two interfaces
  everything else is built against; don't bypass them with ad hoc HTTP or
  SQL calls from elsewhere.

### TDD: red, green

- Every feature or fix starts with a failing test.
- Write the minimum code to make it pass.
- No production code lands without a colocated test: `foo.ts` gets
  `foo.test.ts` next to it in the same directory.
- Core tests need no mocks (the functions are pure). Shell tests mock the
  external boundary they're touching (LLM endpoint, filesystem); the sqlite
  store is exercised against real temp-file databases, not a mock.

### Other conventions worth knowing before you send a PR

- `import { z } from "zod/v4"` — this repo pins to the Zod v4 import path,
  not the default `"zod"` export.
- Shell out via `execFileSync` with an argument array, never `execSync` with
  a template string.
- Any code path that produces a file list must filter through
  `shouldIncludeFile` (extensions/ignoreDirs), rather than re-implementing
  the filter.
- Guard entry-point `main()` invocations with
  `if (process.argv[1] === fileURLToPath(import.meta.url))` so importing a
  module for its exports doesn't also run it.
- `Promise.race` with a `setTimeout`: store the timer id and `clearTimeout`
  it in a `finally`, so a resolved/rejected race doesn't leak a pending timer.

The full list lives in [`CLAUDE.md`](CLAUDE.md) — read it if you're doing
anything nontrivial in `src/`.

## Submitting changes

1. Fork/branch, make your change with tests, run `pnpm sanity`.
2. If the change is user-facing (new command, flag, behavior change, bug
   fix — anything that should show up in a changelog), add a changeset:
   ```bash
   pnpm changeset
   ```
   Pick the appropriate bump (patch for fixes, minor for new
   backwards-compatible features) and describe the change from a user's
   perspective; this becomes the changelog entry when the maintainer
   releases. Internal refactors, docs, and CI changes generally don't need
   one.
3. Open a PR. CI runs lint, typecheck, the config doctor gate, tests, and a
   build + smoke test of the bundled CLI/MCP server output.

Releases themselves (version bump PR + npm publish) are automated by
`.github/workflows/release.yml` via changesets — contributors don't need to
do anything beyond adding the changeset.

## Mutation testing

Stryker configs exist for each layer (`stryker.config.mjs` for `src/core/`,
`stryker.shell.config.mjs` for `src/shell/`, `stryker.mcp.config.mjs` for
`src/mcp-server.ts`), with a 97% mutation-score threshold on the core and
70% on the shell/MCP layers (I/O-heavy code has more mutants that are
equivalent-but-unreachable in unit tests). Only the core config is wired to
a package script:

```bash
pnpm test:mutation                              # src/core/ (stryker.config.mjs)
pnpm exec stryker run stryker.shell.config.mjs  # src/shell/
pnpm exec stryker run stryker.mcp.config.mjs    # src/mcp-server.ts
```

These aren't part of the CI gate (they're slow) — run them locally before a
PR that touches core logic, or when in doubt about test coverage quality.
