# Repo Expert Agents — Letta Cloud Framework

## Project Goal

A framework for creating **persistent AI agents that serve as institutional memory for git repositories** using Letta Cloud. Unlike IDE tools (Cursor, Claude Code) that forget between sessions, these agents accumulate knowledge over time — refining their understanding of architecture, conventions, and cross-repo relationships through every interaction.

The key differentiators over existing code Q&A tools:
- **Persistent, self-updating memory**: Agents distill codebase knowledge into always-in-context summaries that improve with use
- **Cross-repo agent collaboration**: Agents consult each other for questions that span multiple codebases (e.g., "how does the mobile app call the backend API?")
- **Agent-as-a-service**: Agents are headless — they serve humans via CLI, but also other AI systems via API and MCP (CI pipelines, Slack bots, PR review tools, onboarding systems)

The framework is **configuration-driven**: users define their repos in a YAML config, run a single setup command, and get working agents.

## Core Concept

```
repo-expert-agents/
├── CLAUDE.md                    # Project instructions
├── README.md                    # User-facing docs
├── config.example.yaml          # Example configuration
├── config.yaml                  # User's actual config (gitignored)
├── .repo-expert-state.json      # Agent IDs, passage maps, sync state (gitignored)
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                 # CLI entrypoint (setup, query, sync, list)
│   ├── config.ts                # Config loading & validation (zod schemas)
│   ├── agent-factory.ts         # Creates agents from config
│   ├── file-collector.ts        # Walks repos, collects files with filtering
│   ├── sync.ts                  # Incremental git-based sync
│   ├── query.ts                 # Query interface (CLI + programmatic)
│   ├── bootstrap.ts             # Initial codebase analysis prompts
│   ├── state.ts                 # Persists agent IDs, passage maps, metadata
│   └── types.ts                 # Shared type definitions
└── tests/
    └── ...
```

## Architecture

```
                    User / AI Agent
                    (CLI, MCP, API)
                          │
                ┌─────────┼─────────┐
                ▼         ▼         ▼
          ┌──────────┐ ┌──────┐ ┌──────┐
          │ Agent A  │ │  B   │ │  C   │  ← One per repo
          │          │ │      │ │      │
          │ Core:    │ │ Core │ │ Core │  ← Always in context
          │ persona  │ │      │ │      │    (self-updating blocks)
          │ arch     │ │      │ │      │
          │ conven-  │ │      │ │      │
          │ tions    │ │      │ │      │
          │          │ │      │ │      │
          │ Archival:│ │  ... │ │  ... │  ← Vector-searchable source files
          │ passages │ │      │ │      │
          └────┬─────┘ └──┬───┘ └──┬───┘
               │          │        │
               └──────────┼────────┘
              Tag-based discovery
              (send_message_to_agents_matching_all_tags)
```

Letta's three-tier memory maps to codebase knowledge:
- **Core memory** (labeled blocks, always visible): persona, architecture overview, conventions & key APIs — agent self-updates these over time via built-in memory tools
- **Archival memory** (vector store): source files as passages, searchable semantically
- **Recall memory** (conversation history): institutional memory of past interactions

### Core Memory Blocks (3 blocks)

| Block | Purpose | Limit |
|---|---|---|
| `persona` | Agent identity, repo description, role | 5,000 chars |
| `architecture` | High-level architecture, key patterns, directory structure | 5,000 chars |
| `conventions_and_apis` | Coding conventions, key APIs, dependencies, integration points | 5,000 chars |

Agents populate these blocks during bootstrap (initial setup) and refine them over time through conversations. The block content is always in the LLM's context window, so it acts as persistent "working knowledge."

### Cross-Agent Communication

Letta provides three built-in tools for agent-to-agent messaging:

| Tool | Behavior | Use case |
|---|---|---|
| `send_message_to_agent_and_wait_for_reply` | Synchronous, blocking. Returns target's response. | Targeted cross-repo queries |
| `send_message_to_agent_async` | Fire-and-forget with reply receipt. | Notifications, non-blocking updates |
| `send_message_to_agents_matching_all_tags` | Broadcasts to all agents matching tags. Returns list of responses. | Cross-repo queries ("which repo handles X?") |

**Important constraints:**
- Attach only ONE of sync/async tools per agent (attaching both confuses the agent)
- No built-in timeout on synchronous calls — add application-level timeouts
- Each sync call = one full LLM inference round-trip (2-10+ seconds per hop)

Primary discovery mechanism: **tag-based**. All agents get `["repo-expert"]` tag plus repo-specific tags (e.g., `["backend", "api"]`). No need to store peer agent IDs in memory blocks.

### Groups API (Phase 4)

Letta's Groups API provides four orchestration patterns for advanced multi-agent setups:

```typescript
// Dynamic Orchestrator — auto-routes queries to the right agent
const group = await client.groups.create({
  agentIds: [agent1.id, agent2.id, agent3.id],
  description: "Repo expert group with smart routing",
  managerConfig: {
    managerType: "dynamic",
    managerAgentId: orchestrator.id,
    terminationToken: "DONE!",
    maxTurns: 10,
  },
});

// Sleeptime — background agents process memory periodically
const sleepGroup = await client.groups.create({
  agentIds: [summaryAgent.id],
  description: "Background memory processing",
  managerConfig: {
    managerType: "sleeptime",
    managerAgentId: mainAgent.id,
    sleeptimeAgentFrequency: 3,
  },
});
```

## Configuration Design

```yaml
# config.yaml
letta:
  # token loaded from LETTA_API_KEY env var
  model: "openai/gpt-4.1"
  embedding: "openai/text-embedding-3-small"

defaults:
  max_file_size_kb: 50
  memory_block_limit: 5000
  bootstrap_on_create: true

repos:
  mobile-app:
    path: ~/repos/mobile-app
    description: "React Native mobile application"
    extensions: [.ts, .tsx, .js, .jsx, .json, .md]
    ignore_dirs: [node_modules, .git, build, ios/Pods, android/build]
    tags: [frontend, mobile]
    persona: |
      I am an expert on the mobile app repository.
      This is a React Native application.
      I know every screen, component, hook, and navigation flow.

  backend-api:
    path: ~/repos/backend
    description: "Node.js/Python backend API"
    extensions: [.py, .ts, .js, .sql, .yaml, .yml, .json, .md]
    ignore_dirs: [node_modules, .git, __pycache__, .venv]
    tags: [backend, api]
    persona: |
      I am an expert on the backend API repository.
      I know every endpoint, middleware, database model, and business rule.

  data-integration:
    path: ~/repos/data-integration
    description: "ETL pipelines and third-party connectors"
    extensions: [.py, .sql, .yaml, .yml, .json, .md]
    ignore_dirs: [.git, __pycache__, .venv]
    tags: [data, integration]
    persona: |
      I am an expert on the data integration repository.
      I know every pipeline, connector, and transformation.
```

Key design principles:
- **Sensible defaults** — works with minimal config (just repo path + extensions)
- **Per-repo overrides** — persona, extensions, ignore patterns, tags
- **Global defaults** — model, embedding, file size limits, memory block sizes
- **Environment variables** for secrets — API key never in config file
- **Persona is optional** — auto-generate from repo name/description if not provided

## CLI Design

```bash
# First-time setup
repo-expert setup                    # Create all agents from config.yaml
repo-expert setup --repo mobile-app  # Create/recreate a single agent

# Query agents
repo-expert ask mobile-app "How does auth work?"
repo-expert ask --all "What's the API contract for user creation?"
repo-expert ask -i                   # Interactive REPL with @agent targeting

# Sync after code changes
repo-expert sync                     # Sync all repos (git diff based)
repo-expert sync --repo backend-api  # Sync one repo
repo-expert sync --repo backend-api --since "2 hours ago"
repo-expert sync --full              # Full re-index (not incremental)

# Management
repo-expert list                     # List agents with status
repo-expert status                   # Show agent memory stats, last sync
repo-expert destroy                  # Tear down all agents
repo-expert destroy --repo mobile-app
```

## Implementation Priorities

### Phase 0: Spike (Validate Assumptions)

Before building the framework, validate the critical unknowns with a standalone script:

- [ ] **SDK smoke test**: Create an agent with 3 custom memory blocks, insert a passage, send a message, read a block back. Confirm all method signatures match.
- [ ] **Ingestion speed**: Insert 100, 1,000, and 5,000 passages into a single agent. Measure wall-clock time. Test with concurrent requests (p-limit) to find max parallelism Letta tolerates.
- [ ] **Retrieval quality**: After loading a real repo (~1,000 files), test 10 known-answer queries. Does archival search find the right files? What's the hit rate?
- [ ] **Passage lifecycle**: Test passage deletion by ID. Confirm the full create → query → delete → re-create cycle works for incremental sync.
- [ ] **Bootstrap viability**: Prompt an agent to self-analyze its archival memory and populate core memory blocks. Does the output quality justify the approach?

**Exit criteria**: All 5 checks pass, or we identify specific workarounds needed.

### Phase 1: Core Framework (MVP)

- [ ] Project setup: package.json, tsconfig.json, tsx for running TS directly
- [ ] Config loader with YAML parsing and validation (zod schemas)
- [ ] File collector: walk repos with `fs/promises` + glob, filter by extension/ignore/size
- [ ] Agent factory: create Letta agent from config with 3 core memory blocks + archival loading
- [ ] State persistence: save agent IDs and `{ filePath: passageId }` maps to `.repo-expert-state.json`
- [ ] Bootstrap: prompt agent to self-analyze and populate core memory blocks
- [ ] Tag-based agent registration: all agents get `["repo-expert", ...repoTags]`
- [ ] CLI: `setup`, `ask`, `list` subcommands (commander or yargs)
- [ ] `config.example.yaml` with well-documented options

### Phase 2: Sync & Reliability

- [ ] Incremental sync via `git diff --name-only` — delete old passages by ID, insert new ones
- [ ] Fallback: if changed files > 500, trigger full re-index instead of incremental
- [ ] CLI: `sync` subcommand with `--since`, `--full`, `--repo` flags
- [ ] Concurrent passage ingestion with configurable parallelism (based on Phase 0 findings)
- [ ] Handle Letta Cloud rate limits gracefully (retry with backoff)
- [ ] Agent health check / status command showing memory stats and last sync time

### Phase 3: Extensibility

- [ ] MCP exposure guide + helper script for Letta MCP Server setup
- [ ] Plugin system for file collectors (e.g., tree-sitter AST chunking instead of raw files)
- [ ] Support for monorepos: multiple "virtual repos" within a single git repo
- [ ] `repo-expert export` — dump agent memory to markdown for debugging/inspection
- [ ] Custom tools registry: let users define additional agent tools in config

### Phase 4: Advanced Features

- [ ] Smart routing: Groups API DynamicManager with an orchestrator agent that auto-routes queries
- [ ] Sleep-time processing: Groups API SleeptimeManager for background memory refinement
- [ ] PR review integration: agent comments on PRs via GitHub/GitLab webhooks
- [ ] Onboarding mode: guided codebase walkthrough for new developers

## Technical Decisions & Constraints

**Why Letta Cloud (not self-hosted)**
- Self-hosted requires PostgreSQL with 42 tables — too much ops overhead
- Cloud handles scaling, persistence, and model routing
- Tradeoff: vendor dependency, no published pricing, potential cost at scale
- Mitigation: keep an adapter-friendly interface so the backend could be swapped

**File loading strategy**
- Load full file content with `FILE: <path>` prefix into archival passages
- Skip files > 50KB (configurable) — usually generated/vendored
- Skip binary files, node_modules, build artifacts
- Future: tree-sitter AST chunking for better retrieval (Phase 3)

**Cross-agent communication**
- Primary: `send_message_to_agents_matching_all_tags` (tag-based discovery, no IDs needed)
- Fallback: `send_message_to_agent_and_wait_for_reply` (when targeting a specific known agent)
- Only attach ONE of sync/async tools per agent
- Application-level timeouts on all cross-agent calls

**State management**
- `.repo-expert-state.json` stores: agent IDs, passage-to-file-path maps, last sync commit, timestamps
- Config changes trigger diff-based updates (don't recreate agents unnecessarily)
- `.repo-expert-state.json` should be gitignored

**Incremental sync**
- `git diff --name-only <last-sync-commit>..HEAD` identifies changed files
- For each changed file: delete old passage (by stored ID), insert new passage, update map
- Threshold: >500 changed files → fallback to full re-index
- Store last synced commit SHA per repo in state file

## Letta SDK Patterns (TypeScript)

The framework uses `@letta-ai/letta-client` (npm). Key patterns:

```typescript
import { LettaClient } from "@letta-ai/letta-client";

const client = new LettaClient({ token: process.env.LETTA_API_KEY });

// Create agent with custom memory blocks
const agent = await client.agents.create({
  name: "mobile-app-expert",
  model: "openai/gpt-4.1",
  embedding: "openai/text-embedding-3-small",
  memoryBlocks: [
    { label: "persona", value: "I am an expert on the mobile app repository...", limit: 5000 },
    { label: "architecture", value: "Not yet analyzed.", limit: 5000 },
    { label: "conventions_and_apis", value: "Not yet analyzed.", limit: 5000 },
  ],
  tools: ["send_message_to_agents_matching_all_tags"],
});

// Load files into archival memory (passages)
const passage = await client.agents.passages.create(agent.id, {
  text: "FILE: src/index.ts\n\n<file content>",
});
// Store passage.id in state file for later deletion during sync

// Query agent
const response = await client.agents.messages.create(agent.id, {
  messages: [
    { role: "user", content: "How does auth work?" },
  ],
});

for (const message of response.messages) {
  console.log(message);
}

// Read a specific memory block
const archBlock = await client.agents.blocks.retrieve(agent.id, "architecture");
console.log(archBlock.value);

// Modify a block
await client.agents.blocks.modify(agent.id, "architecture", {
  value: "Updated architecture summary...",
});
```

**SDK caveats:**
- The Letta SDK evolves frequently. Always check [docs.letta.com](https://docs.letta.com) and the [TypeScript SDK repo](https://github.com/letta-ai/letta-node) for current API shape.
- Pin the exact SDK version in `package.json`. Run integration tests on every SDK update.
- Base tools (archival_memory_search, core_memory_replace, etc.) appear to be included by default — no `include_base_tools` flag needed.

## Tech Stack

- **TypeScript** — Primary language
- **@letta-ai/letta-client** — Letta Cloud SDK
- **zod** — Config validation
- **yaml** (js-yaml) — Config parsing
- **commander** — CLI framework
- **execa** — Git operations
- **fast-glob** — File discovery
- **p-limit** — Concurrency control for passage ingestion
- **tsx** — Run TypeScript directly during development
- Node.js 18+ required

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **SDK instability** — method signatures change between versions | High | High | Pin exact SDK version. Write integration tests for every SDK method used. |
| 2 | **Poor retrieval quality** — raw file dumps produce irrelevant vector search results | High | High | Phase 0 validates retrieval. Phase 3 adds tree-sitter chunking. Consider Aider's repo-map technique for core memory blocks. |
| 3 | **Slow ingestion** — loading large repos takes 10-30 min via sequential API calls | Medium | High | Phase 0 measures actual speed. Use concurrent insertion (p-limit). Consider loading only high-value files. |
| 4 | **Letta Cloud cost/availability** — no published pricing, potential rate limits | Medium | High | Adapter-friendly interface. Could swap to local RAG backend if needed. |
| 5 | **Cross-agent latency** — sync calls compound to 30+ seconds for multi-hop queries | Medium | Medium | Default to single-agent queries. Cross-agent only on explicit `--all` flag. |

## Relevant Ecosystem

- **Letta Groups API**: Supervisor-Worker, Dynamic Orchestrator, Sleeptime, Round-Robin patterns for multi-agent coordination
- **Letta MCP Server**: Expose agents to Claude Code, Cursor, etc. via MCP protocol
- **Greptile**: Alternative for pure code Q&A ($0.15/query API) — no persistence or cross-repo
- **Aider repo map**: tree-sitter + PageRank for compressed codebase understanding — worth stealing for file collector / core memory
- **Existing code MCP servers**: RagCode MCP, Claude Context MCP (Zilliz) — reference implementations

## Quality Bar

A developer should be able to `npx repo-expert setup`, point at their repos via YAML config, and have working agents in minutes. The README is the primary onboarding doc — zero to querying in under 10 minutes.

This is not "better code Q&A" (Cursor/Claude Code already do that well). This is **institutional memory for your codebases that persists across sessions, reasons across repos, and serves both humans and AI systems**.
