---
"repo-expert": patch
---

Make the npm-installed package fully functional: `mcp-install`/`mcp-check` now detect how repo-expert is running and write an entry that launches the bundled `dist/bin/mcp-server.mjs` (previously they always wrote `npx tsx src/mcp-server.ts`, which requires the tsx devDependency and fails for npm installs). Both bin entry points resolve npm's bin symlinks so they run when invoked via `node_modules/.bin`, tree-sitter wasm files resolve through Node module resolution so indexing works when npm hoists dependency packages above the installed package, and passage loading no longer loses the provider's `this` binding (every chunk failed with "Cannot read properties of undefined"). The CLI's `--version` reports the real package version instead of a hardcoded `0.1.0`, and the stale `main` field pointing at a nonexistent `index.js` was removed. Docs now lead with the `npm install -g repo-expert` path.
