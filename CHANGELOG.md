# Changelog

## 1.0.1

### Patch Changes

- a39b3dd: Make the npm-installed package fully functional: `mcp-install`/`mcp-check` now detect how repo-expert is running and write an entry that launches the bundled `dist/bin/mcp-server.mjs` (previously they always wrote `npx tsx src/mcp-server.ts`, which requires the tsx devDependency and fails for npm installs). Both bin entry points resolve npm's bin symlinks so they run when invoked via `node_modules/.bin`, tree-sitter wasm files resolve through Node module resolution so indexing works when npm hoists dependency packages above the installed package, and passage loading no longer loses the provider's `this` binding (every chunk failed with "Cannot read properties of undefined"). The CLI's `--version` reports the real package version instead of a hardcoded `0.1.0`, and the stale `main` field pointing at a nonexistent `index.js` was removed. Docs now lead with the `npm install -g repo-expert` path.

All notable changes to this project are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/) once releases
begin. The entries below `[Unreleased]` were written by hand, summarizing
work on this branch before release automation existed — see "Release
process" at the bottom for how entries are generated from here on.

## [Unreleased]

### Added

- Git log evidence included in memory consolidation prompts, with a
  range/since/recent fallback chain (`selectEvidenceSource`).
- Fingerprint-based no-op detection for consolidation: the LLM turn is
  skipped when the architecture/conventions blocks would come back
  unchanged, and `lastConsolidatedCommit` is only stamped on a real change.
- Checkpoint fallback chain for `sync` when the stored checkpoint commit is
  orphaned (rebase, force-push, `gc`): falls back to `--since`/full-reindex
  where possible, or fails fast with explicit `--since <ref>`/`--full`
  recovery instructions when it isn't.
- `install-instructions` command: deterministic, marker-delimited splice of
  a repo-expert block into `CLAUDE.md`/`AGENTS.md` (`--repo`/`--file`/
  `--remove`/`--dry-run`); `mcp-install` now hints at it.
- `self-check` probes that `better-sqlite3`/`sqlite-vec` actually load and
  run a query, with ABI-mismatch/`pnpm approve-builds` guidance on failure.
- `setup` preflight: the LLM endpoint and configured models are verified
  before any indexing starts, with actionable failures ("is Ollama
  running? Try: ollama serve" / "try: ollama pull <model>"); skip with
  `--skip-preflight`. `doctor` gained the same model-existence checks.
- `init` probes the chosen LLM base URL and warns immediately if it's
  unreachable, and now offers the embedding engine choice
  (`http` vs in-process `transformersjs`) interactively and via
  `--embedding-engine`.
- `onboard` gained a timeout (`--timeout-ms`, default 120s) and a progress
  line instead of appearing to hang on slow local models.

### Changed

- Package renamed to **repo-expert**, matching the product identity (name
  confirmed unclaimed on npm).
- `bin` entries (`repo-expert`, `repo-expert-mcp`) now point at the built
  `dist/bin/*.mjs` output instead of source; `prepublishOnly` runs the build.
- npm package `files` allowlist trimmed to `dist`, README, LICENSE, the
  config example, and the two published docs — tarball drops from ~225
  files/9.2MB to ~12 files/1.7MB.
- `~/.repo-expert` (the data directory holding indexed source and
  conversation history) is now created with mode `0700`.
- `completion` now covers the previously-missing `reconcile`/`consolidate`/
  `install-instructions` commands across bash/zsh/fish.
- pnpm build-script allowlist and the `hono` override moved from the
  (now-ignored) `package.json` `pnpm` block to `pnpm-workspace.yaml`, and
  trimmed to only `better-sqlite3`/`tree-sitter-cli` (dropping unused
  `tree-sitter-kotlin`/`tree-sitter-swift` native builds).

### Performance

- Embeddings are batched during indexing: one embedding request per 32
  chunks instead of one per chunk, with per-batch transactional inserts
  (a failed embed leaves no partial rows).
- Tree-sitter grammars load in parallel at startup; agent deletion uses
  chunked `WHERE rowid IN (...)` deletes instead of one statement per row.
- `doctor --fix`'s seeded placeholder config now explains it needs editing
  instead of failing the next `doctor` run with a generic error.

### Fixed

- `init` backs up an existing `config.yaml` to `config.yaml.bak` instead of
  silently overwriting it.
- MCP server hardening: `agent_call` (and other tools) now cancel in-flight
  LLM work on timeout via a shared `withTimeoutSignal` instead of leaking
  orphaned requests; `agent_get`/`agent_call`/etc. give an honest "agent not
  found" error for a bad `agent_id`; `agent_delete_passage` reports a real
  not-found instead of a silent no-op; `top_k` is validated as a positive
  integer; `agent_update_block` guards the persona block and enforces the
  memory block character limit; the server's handshake version is read from
  `package.json` instead of hardcoded.
- sqlite store sets `busy_timeout=5000` alongside WAL mode, so the watch
  daemon and CLI sharing `store.db` don't collide.
- `file-collector` skips unreadable files (broken symlinks, `EACCES`) with a
  warning instead of aborting the whole repo collection.
- Watch daemon: post-sync consolidation now gathers git evidence and stamps
  `lastConsolidatedCommit` the same way the manual `consolidate` command
  does (previously only the manual path did); an orphaned sync checkpoint
  now stops the daemon loop cleanly (timers cleared, watchers closed) with
  a non-zero exit instead of silently degrading forever.
- Fixed a broken esbuild bundle: missing `onnxruntime-node` external,
  double shebang, and a missing `createRequire` shim for bundled CJS deps.

### Documentation

- Removed eval tasks that graded against features that no longer exist;
  marked Letta-era vision docs as superseded by the local implementation.

## Release process

From here on, versioned sections of this file are generated by
[Changesets](https://github.com/changesets/changesets): contributors run
`pnpm changeset` to describe a user-facing change, and
`.github/workflows/release.yml` turns accumulated changesets into a version
bump PR and, once merged, a new dated section here plus an npm publish.
