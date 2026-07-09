# Product Refinement Plan — repo-expert v1

Status: active
Date: 2026-07-07

Synthesis of three parallel investigations: (1) competitive/technical landscape research, (2) codebase polish reconnaissance, (3) product-readiness/packaging audit. Baseline at time of writing: 939 tests green, lint/typecheck clean, functional-core/imperative-shell boundary mechanically enforced.

## 1. Positioning

The market moved while this was being built:

- **Letta shipped "Context Repositories"** (Feb 2026): git-versioned agent memory, sleep-time reflection, subagent bootstrap — the closest competitor to this project's core pitch.
- **Claude Code's CLAUDE.md + auto-memory** already gives frontier tools persistent project memory, which weakens the "IDE tools forget between sessions" framing.
- **Code retrieval consensus shifted** from embedding-chunk RAG to agentic search (grep/AST navigation) and tree-sitter code graphs (Aider repo-map lineage; Anthropic dropped Claude Code's vector RAG; Continue deprecated `@codebase`).
- **The open lane is local-first privacy**: Cursor uploads vectors to a cloud index (Turbopuffer); Sourcegraph Cody went enterprise-only ($59/user/mo); Ollama is at ~52M monthly downloads.

**Strategy:** keep the local-first identity — "your code, your vectors, your machine, nothing uploaded, ever" — but reposition from *competitor to* the frontier coding agents to *memory layer underneath them*:

1. The **MCP server is the primary product surface**. Devs live in Claude Code/Cursor/Codex; repo-expert feeds them durable local repo knowledge.
2. **Don't fight CLAUDE.md — generate it.** Make repo-expert the engine that authors and maintains CLAUDE.md / Cursor rules / AGENTS.md from accumulated memory (`install-instructions` is the seed of this).
3. Get **verified-owner listings** on MCP registries (Glama, Smithery, mcp.so, official registry).

## 2. Ship blockers (v1 cannot exist without these)

Nobody can install the product today. In dependency order:

1. **Fix the npm install path.** `bin` points at `src/*.ts`, whose `.js` specifiers only resolve through `tsx` (a devDependency). `node src/cli.ts` fails outright. Fix: `prepublishOnly` runs `pnpm build`; `bin` points at `dist/` output; verify `node dist/cli.mjs --help` works.
2. **Add a `files` allowlist.** `npm pack` currently ships 225 files / 9.2 MB including test files, internal planning docs, `.ai-sdlc/`, `.claude/napkin.md`, spikes, and Stryker configs.
3. **Claim the `repo-expert` npm name** (confirmed unclaimed, 404 on registry) and resolve the `agent-as-repo` / `repo-expert` naming split — the product identity is `repo-expert` everywhere except the package/repo name.
4. **Fill package.json metadata**: description, keywords, author, repository, homepage, bugs.
5. **Wire changesets to CI**: a release workflow running `changeset version` / `changeset publish` on main; first real git tag. Treat the current `1.0.0` as unreleased.
6. **SEA binaries as release artifacts** (second distribution channel): CI matrix (macOS/Linux, arm64/x64) running `build-sea.sh`, uploading to GitHub Releases. The script is technically sound but currently single-platform and never runs in CI.

## 3. Polish wave 1 — safe, high-value fixes (this branch)

From the reconnaissance report, ordered by user impact:

- `init` silently overwrites `config.yaml` (src/shell/init.ts) — back up / refuse without confirmation.
- Timeouts that don't cancel: `mcp-server.ts` `withTimeout` and `group-provider.ts` `broadcastAsk` race a timer but never thread an `AbortSignal`; orphaned LLM responses can clobber newer memory writes. Consolidate on the one correct implementation (`cli.ts` `withTimeoutSignal`).
- No `busy_timeout` pragma on the sqlite store, despite watch-daemon + CLI concurrent access being the designed-for scenario.
- `self-check` never verifies `better-sqlite3`/`sqlite-vec` actually load — the most likely first-run failure passes its own diagnostic.
- MCP tool hardening: nonexistent `agent_id` silently "succeeds"; `agent_delete_passage` reports success for unknown IDs; `top_k: 0` returns empty instead of validation error; `agent_update_block` lacks the persona guardrail that `consolidateMemory` enforces.
- `file-collector.ts`: one permission-denied file aborts collection for the entire repo (sync.ts already does per-file try/catch).
- Stale vision docs (`idea.md`, `feasibility-analysis.md`, `phase-0-findings.md`) describe the abandoned Letta Cloud architecture with nothing marking them superseded — first-impression risk.
- `eval/tasks.json` grades against commands/env vars that don't exist (`eval` subcommand, `REPO_EXPERT_TELEMETRY_PATH`, `ask -i`).
- Shell completion omits `reconcile`, `consolidate`, `install-instructions`; the test fixture hardcodes the same stale list.
- `~/.repo-expert` created with default umask — should be `0o700` (holds indexed source + conversation history).
- `mcp-server.ts` hardcodes `version: "1.0.0"` independent of package.json.

## 4. Polish wave 2 — first-run experience

Goal: `init` → `setup` → `ask` succeeds or fails *fast and clearly*.

- Preflight in `init`/`setup`: reuse `doctor`'s `checkLlmEndpoint` so a missing Ollama or unpulled model fails before indexing, not mid-way. `doctor` should also verify the configured model exists on the endpoint, not just reachability.
- Offer `embedding_engine: transformersjs` during `init` prompts (removes the second-model-pull prerequisite entirely).
- `doctor --fix` seeds the example config's placeholder repo path, which fails the next `doctor` run — seed something valid or point at the edit.
- Progress indicators on `setup`/`onboard` (long LLM/indexing operations currently read as hung).
- Embedding batching: `writePassage` sends one HTTP round-trip per chunk even though the client supports batched arrays — the single biggest indexing-latency multiplier.
- Parallelize file collection/chunking (currently sequential await-in-loop); parallelize grammar loads at startup.

## 5. Technical roadmap — retrieval & memory (the moat)

In priority order, per the landscape research:

1. **Agentic search surface** (landed 2026-07-09 — see `docs/plans/2026-07-09-agentic-search-spec.md`): CLI `ask` gets ripgrep/glob/file-read; MCP stays memory + hybrid recall (host harness already has filesystem tools). Symbol-lookup / repo-map remains roadmap item 2.
2. **Tree-sitter symbol/dependency graph with PageRank ranking** (landed 2026-07-09): definition index, TS/JS + Python/Go refs, path aliases, core graph/PageRank, sync-time `symbolFiles`/`symbolRanks` + CLI `find_symbol`, PageRank evidence in consolidate prompts. See `docs/plans/2026-07-09-tree-sitter-repo-map-spike-findings.md`, `2026-07-09-symbol-refs-findings.md`, `2026-07-09-symbol-graph-pagerank-findings.md`, `2026-07-09-repo-map-followups-findings.md`. Go module-path resolution and worktree memory remain follow-ups.
3. **Git-versioned memory + worktree-isolated consolidation.** Phase A landed 2026-07-09: optional `memory.git_versioned` writes persona/architecture/conventions as markdown under `.repo-expert/memory` (`GitMarkdownBlockStorage`). Worktree-isolated consolidate + auto-commit + sleep-time job remain.
4. **Retrieval quality trio** (all local, cheap): contextual chunk prefixes ("this chunk is from FILE, function X, does Y"), BM25 + vector hybrid (**landed**; path-scoped filter landed with agentic search), local cross-encoder reranker via transformers.js. Anthropic's contextual-retrieval numbers: 49–67% fewer retrieval failures. Content-hash skip on sync also landed (Merkle-inspired, not a full Merkle tree).
5. **Public benchmark.** Fix the eval harness, then publish repo-QA numbers (local repo-expert vs cloud tools at $0 API cost). Concrete numbers drive OSS adoption.

## 6. Launch checklist (dependency order)

1. Wave-1 polish fixes green (this branch)
2. npm install path fixed + `files` allowlist (§2.1–2)
3. Rename/claim `repo-expert` on npm; fill metadata (§2.3–4)
4. Release workflow via changesets; first tag; CHANGELOG + CONTRIBUTING (§2.5)
5. Wave-2 first-run fixes; README "just try it" path (`npx repo-expert init`)
6. SEA binary CI matrix + GitHub Releases; brew tap (§2.6)
7. MCP registry listings with verified-owner status
8. Retrieval roadmap items 1–2 (agentic search, repo map) as the headline v1.1 features
9. Public benchmark + launch post

## 7. Explicitly deferred

- Windows daemon story (systemd/Task Scheduler equivalents of launchd watch) — document `watch` as the manual path first.
- Temporal knowledge graphs (Zep/Graphiti-style) — heavy; borrow only time-stamped supersede-able facts later.
- `group-provider` roundRobin/supervisorFanOut orchestration — implemented and tested but unwired; decide to wire or delete before v1.1.
- MCP transitive audit advisories (all in the SDK's HTTP-transport deps; stdio-only usage today) — revisit if HTTP/SSE transport ships.
