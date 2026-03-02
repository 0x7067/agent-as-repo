# Deep Analysis: repo-expert (agent-as-repo)

> Research audit — March 2026

## Context

A comprehensive audit of the project's concept, current state, competitive landscape, and actionable recommendations.

---

## 1. What This Project Is

**repo-expert** creates persistent AI agents (one per git repo) hosted on Letta Cloud that serve as *institutional memory* for codebases. Unlike IDE tools that forget between sessions, these agents:

- **Accumulate knowledge** — source files are chunked (~2KB) and stored as vector-searchable archival passages; architecture/conventions summaries live in always-in-context core memory blocks that the agent self-updates over time
- **Communicate cross-repo** — agents discover each other via tags and answer questions spanning multiple codebases
- **Serve as infrastructure** — headless agents accessible via CLI, MCP (8 tools over stdio), or direct API — usable by humans, CI, Slack bots, other AI systems

The project is mature: ~48 test files, hexagonal architecture (ports/adapters), mutation testing (97% core, 70% shell), macOS launchd daemon, SEA standalone binaries, comprehensive CLI (20+ commands).

---

## 2. What's Working Well

**Architecture quality is high.** The functional core / imperative shell separation is rigorously enforced (ESLint + architecture tests). Pure core functions need no mocks. Ports are interface-only. This is textbook hexagonal architecture.

**Research-driven development.** 17 spike scripts, a formal feasibility analysis, a Phase 0 go/no-go gate, and 30+ documented corrections in `napkin.md`. The team validated every critical assumption before building.

**Operational completeness.** The tool handles the full lifecycle: init, setup, sync, watch, reconcile, export, destroy, doctor, self-check, daemon management. Few side-projects reach this level of operational polish.

**Test discipline.** TDD with colocated tests, Stryker mutation testing at strict thresholds, and an E2E spike that exercises the full CLI lifecycle against live Letta APIs.

---

## 3. The Core Tension: What Problem Does This Solve in 2026?

The project's thesis (from `idea.md`):

> *"This is not 'better code Q&A' — it is institutional memory for your codebase that other AI systems can consult."*

Three differentiators were identified:
1. Persistent, self-updating memory
2. Cross-repo agent collaboration
3. Agent-as-a-service (MCP, API)

**The landscape has shifted since this was conceived.** Let me assess each differentiator:

### 3.1 Persistent Memory — Narrowing Moat

- **Greptile** ($30/dev/month) now has long-term memory that learns team review patterns and preferences
- **Windsurf** has "Memories" — persistent storage of architectural decisions, user preferences, and project rules
- **Claude Code** has CLAUDE.md, episodic memory across sessions, and MCP-powered knowledge bases
- **Mem0** ($24M raised, AWS exclusive memory provider) offers a universal memory layer with graph + vector + KV stores, claiming 26% accuracy improvement over baseline
- **Letta's own Learning SDK** and **Skill Learning** now let agents learn from experience and improve over time — features that repo-expert partially reinvents

**However:** None of these competitors offer *codebase-scoped institutional memory that survives across all tools*. Claude Code remembers per-session. Greptile remembers review patterns but not deep architectural knowledge. Windsurf's memories are IDE-bound. repo-expert's value is that the memory lives *outside* any specific tool and is queryable by any system via MCP or API.

### 3.2 Cross-Repo Collaboration — Underexploited

This is genuinely unique. No competing tool lets you ask "how does the mobile app authenticate against the backend API?" and get an answer that consults both repo agents. But:

- The `group-provider.ts` orchestration is client-side only (no autonomous cross-agent reasoning)
- The `--all` flag on `ask` is the only entry point
- There's no "smart routing" where an agent autonomously decides to consult a peer
- Cross-agent latency (2-10s per hop) makes multi-hop reasoning painful

### 3.3 Agent-as-a-Service — Strong, but MCP Alone Isn't Enough

The MCP server is well-built (8 typed tools, better than Letta's official `letta-mcp`). But:

- The MCP tools are generic Letta wrappers — they don't expose repo-expert-specific workflows (sync, reconcile, onboard)
- No webhook integration (GitHub PR reviews, Slack notifications)
- No CI/CD integration (post-merge auto-sync, PR comment agent)

---

## 4. Competitive Landscape Analysis

| Tool | Persistent Memory | Cross-Repo | Agent-as-Service | Code Understanding | Price |
|------|:-:|:-:|:-:|:-:|:-:|
| **repo-expert** | Yes (Letta archival + core blocks) | Yes (tag-based messaging) | Yes (CLI + MCP) | Raw text chunks (~2KB) | Letta Cloud (free tier?) |
| **Greptile** | Learning review patterns | No | API ($0.15/query) | Code graph, multi-hop | $30/dev/mo |
| **Claude Context MCP** (Zilliz) | No | No | MCP only | Vector search over codebase | Free/OSS |
| **Aider repo-map** | No | No | No | Tree-sitter + PageRank | Free/OSS |
| **CodeRLM** | No | No | MCP + JSON API | Tree-sitter symbol index | Free/OSS |
| **Mem0** | Yes (graph + vector + KV) | No | SDK/API | Generic (not code-specific) | Free tier + paid |
| **OpenViking** | Yes (file-system paradigm) | No | REST API | L0/L1/L2 tiered context | Free/OSS |
| **Letta Code** | Yes (Context Repositories) | Via Letta platform | IDE only | Git-versioned memory | Letta pricing |
| **Windsurf Memories** | Yes (IDE-bound) | No | No | AST + vector hybrid | IDE pricing |

**Key insight:** repo-expert occupies a unique niche as the only tool combining persistent codebase memory + cross-repo reasoning + headless agent-as-service. But the code understanding layer (raw 2KB text chunks) is the weakest link — every serious competitor uses AST-aware indexing.

---

## 5. Improvement Recommendations

### 5.1 CRITICAL: Upgrade Code Understanding (Tree-sitter Chunking)

**Current state:** Files are split into ~2KB text chunks with `FILE: <path>` headers. This is the approach that Phase 0 identified as "Risk #2: Poor retrieval quality" with tree-sitter chunking planned for Phase 3 but never implemented.

**Why this matters:** Raw text chunking means:
- A function definition split across chunk boundaries loses coherence
- Import statements / class hierarchies get separated from their usage
- No symbol-level retrieval ("find all callers of `authenticate()`")
- Vector search over raw text is fundamentally less precise than over structured representations

**Recommended approach — steal Aider's pattern:**

1. Use tree-sitter to parse files into AST nodes (functions, classes, interfaces, type definitions)
2. Chunk at symbol boundaries (a function is one chunk, a class is one chunk)
3. Prefix each chunk with structural context: `FILE: src/auth.ts | CLASS: AuthService | METHOD: authenticate`
4. Build a lightweight dependency graph (imports/exports) and store it in a core memory block
5. Use PageRank-inspired ranking to identify the most "important" symbols for core memory summarization

This would dramatically improve retrieval quality without changing the Letta storage model — each symbol becomes a passage with richer metadata.

**Tools:** `tree-sitter` + language grammars (40+ languages supported). The `web-tree-sitter` npm package works in Node.js. Aider's RepoMapper is a reference implementation. CodeRLM is another.

### 5.2 HIGH: Adopt OpenViking as a Storage Backend

The `VikingHttpClient` already exists in the codebase (`src/shell/viking-http.ts`). OpenViking is designed exactly for this use case:

- **File-system paradigm** for organizing agent context (vs. flat passage list)
- **L0/L1/L2 tiered loading** — load directory structure first, then summaries, then full content on demand
- **Built-in semantic search** scoped to directories (repo-scoped search without tag filtering hacks)
- **Self-evolving** — designed for agents that update their own context

This would solve several current pain points:
- Passage management complexity (the entire reconcile/sync dance)
- The 5000-char core memory block limit (OpenViking has richer context structures)
- The "agent adds spurious tag filters" problem documented in Phase 0

**Approach:** Implement an `OpenVikingProvider` that satisfies the `AgentProvider` port. Keep `LettaProvider` for the agent runtime (conversation, reasoning, tool use) but store source file context in OpenViking. This is a hybrid architecture: Letta for agent behavior, OpenViking for codebase context.

### 5.3 HIGH: Expose Repo-Expert Workflows via MCP

The current MCP server exposes raw Letta primitives. This is useful but misses the higher-value operations:

**Add repo-expert-specific MCP tools:**
- `repo_expert_ask` — ask a repo agent a question (wraps the full ask flow with timeout, model selection)
- `repo_expert_sync` — trigger a sync for a repo
- `repo_expert_status` — get agent health and last sync time
- `repo_expert_onboard` — start an onboarding walkthrough
- `repo_expert_search_code` — semantic search across all repos (fan-out to multiple agents)

This would make repo-expert genuinely useful as infrastructure for other AI systems, not just a Letta API proxy.

### 5.4 MEDIUM: Integrate Letta's Learning SDK / Skill Learning

Letta's new [Learning SDK](https://github.com/letta-ai/learning-sdk) and [Skill Learning](https://www.letta.com/blog/skill-learning) let agents learn from interactions:

- **Learning SDK**: Wrap LLM calls in a `learning()` context to enable continual learning
- **Skill Learning**: Agents distill experience into reusable skills

repo-expert's bootstrap process (agent self-analyzes codebase → populates core memory blocks) is a manual version of what Skill Learning automates. Integrating these features would:

- Improve core memory quality over time without manual re-bootstrapping
- Let agents learn team-specific patterns from `ask` interactions
- Reduce the complexity of the bootstrap/sync pipeline

### 5.5 MEDIUM: Add Mem0 as an Alternative Memory Backend

Given the `AgentProvider` abstraction, implementing a `Mem0Provider` would be relatively clean. Benefits:

- **Graph memory** captures relationships between code concepts (function A calls B, module X depends on Y) — something flat passages can't represent
- **Memory compression** — Mem0 claims 80% prompt token reduction
- **Temporal tracking** — Zep-style "how did this code evolve?" queries
- Eliminates Letta Cloud vendor lock-in for the memory layer

This doesn't require abandoning Letta — you could use Letta for agent orchestration while delegating memory to Mem0.

### 5.6 MEDIUM: Build the PR Review Integration

This was planned for Phase 4 but never built. It would be the killer feature for the "agent-as-a-service" positioning:

1. GitHub webhook receives PR event
2. Agent receives the diff + PR description
3. Agent reviews against its institutional knowledge of architecture/conventions
4. Posts comments on the PR

This leverages every differentiator: persistent memory (knows the codebase deeply), cross-repo (can check API contracts across repos), and agent-as-service (runs headlessly in CI).

### 5.7 LOW: Consider Dropping Letta as the Primary Runtime

This is the most radical suggestion. Letta provides:
1. Agent orchestration (tool use, memory management, conversation)
2. Memory storage (core blocks, archival passages, recall)
3. Cross-agent communication (tag-based messaging)

But each of these has alternatives that may offer more control and flexibility:

| Letta Feature | Alternative | Advantage |
|---|---|---|
| Agent orchestration | Direct LLM API calls (OpenAI/Anthropic) + custom tool loop | Full control, no SDK quirks, cheaper |
| Memory storage | OpenViking, Mem0, or local pgvector | No vendor lock-in, richer memory models |
| Cross-agent messaging | Direct function calls (same process) or message queue | Lower latency, no LLM inference per hop |
| Core memory blocks | System prompt composition (template + stored summaries) | No 5000-char limit, more flexible |

**The case for keeping Letta:** Sleep-time memory consolidation, built-in memory tools (the agent can edit its own memory), and the conversation/recall system are genuinely hard to replicate. Letta's value is strongest as an *agent runtime*, not as a *storage backend*.

**Hybrid recommendation:** Keep Letta for agent behavior. Move codebase indexing to OpenViking or a local solution. Use Mem0 or a custom solution for institutional memory (patterns learned from interactions).

---

## 6. Alternative Architectural Approaches

### 6.A: "Smart Context Server" (MCP-native, no agent runtime)

Instead of persistent Letta agents, build a stateless MCP server that:
1. Indexes repos locally using tree-sitter (no cloud dependency)
2. Stores symbol index + embeddings in local SQLite/pgvector
3. Responds to MCP queries with precise, structured code context
4. Maintains a `knowledge.md` file per repo (updated by CI) with architecture/conventions summaries

**Pros:** Zero cloud dependency, instant startup, works offline, integrates with any MCP client
**Cons:** No persistent agent memory, no cross-repo reasoning, no self-updating knowledge
**When to choose:** If the primary use case is "give Claude Code / Cursor better codebase context"

This is essentially what **CodeRLM** and **Claude Context MCP** do, but with repo-expert's configuration-driven multi-repo support.

### 6.B: "Memory-Enhanced RAG" (Mem0 + tree-sitter + direct LLM)

Skip the agent runtime entirely:
1. Tree-sitter indexes repos into structured chunks
2. Mem0 stores chunks with graph relationships (imports, calls, inheritance)
3. On query: retrieve relevant chunks via Mem0's hybrid search, compose a prompt, call LLM directly
4. Mem0's learning layer automatically extracts and stores insights from interactions

**Pros:** Best-in-class memory (graph + vector + temporal), no Letta dependency, simpler architecture
**Cons:** No agent self-editing, no conversation continuity, must build tool-use loop yourself
**When to choose:** If institutional memory quality matters more than agent autonomy

### 6.C: "Letta + OpenViking Hybrid" (recommended evolution)

Keep Letta agents for conversation/reasoning, but upgrade the context pipeline:
1. **OpenViking** for hierarchical codebase storage (replaces flat archival passages)
2. **Tree-sitter** for AST-aware chunking (replaces raw 2KB text splits)
3. **Letta Learning SDK** for continual improvement (replaces manual bootstrapping)
4. **MCP tools** expose repo-expert workflows (not just raw Letta primitives)

**Pros:** Preserves existing architecture, incremental migration, leverages Letta's strengths (agent runtime) while addressing weaknesses (memory storage, code understanding)
**Cons:** Still depends on Letta Cloud, adds OpenViking as another dependency
**When to choose:** If you want to evolve the current project rather than rewrite it

---

## 7. Specific Technical Improvements

| Area | Current | Suggested | Impact |
|---|---|---|---|
| **Chunking** | Raw text ~2KB splits | Tree-sitter symbol-boundary chunks with structural prefixes | Retrieval quality +++ |
| **MCP tools** | 8 generic Letta wrappers | + 5 repo-expert workflow tools | Usability as infrastructure +++ |
| **PR review** | Not implemented | GitHub webhook → agent review → PR comment | Killer feature for adoption |
| **Core memory** | 3 x 5000-char blocks | PageRank-ranked symbol importance + dependency graph summary | Architecture understanding ++ |
| **Sync pipeline** | Delete-first creates inconsistency window | Copy-on-write: upload new passages *before* deleting old ones | Reliability ++ |
| **Watch daemon** | `fs.watch` (unreliable on Linux) | `chokidar` or `@parcel/watcher` for cross-platform file watching | Portability ++ |
| **MCP mutation testing** | 0% threshold | Raise to 70% (matches shell) | Test confidence ++ |
| **E2E tests** | Spike scripts (not in CI) | Integrate thorough E2E into CI with test Letta account | Regression safety ++ |
| **Cross-agent routing** | Client-side `--all` broadcast only | Agent-initiated peer consultation (Letta's built-in messaging) | Cross-repo UX ++ |
| **Context Repositories** | Not used (Letta Code-only) | Monitor API availability; adopt when REST API ships | Memory quality ++ |

---

## 8. What I'd Prioritize (Ordered)

1. **Tree-sitter chunking** — Biggest retrieval quality improvement for least architectural disruption
2. **Repo-expert MCP tools** — Makes the "agent-as-service" story real
3. **PR review integration** — The single most compelling use case for persistent codebase agents
4. **OpenViking integration** — Better storage model for hierarchical codebase context
5. **Letta Learning SDK** — Replace manual bootstrap with continual learning
6. **Raise MCP Stryker threshold** — Close the test coverage gap
7. **Cross-platform watch** — Replace `fs.watch` with reliable cross-platform watcher
8. **Mem0 as alternative backend** — Reduce vendor lock-in, explore graph memory for code relationships

---

## 9. Sources

- [Letta Platform](https://www.letta.com/)
- [Letta Context Repositories](https://www.letta.com/blog/context-repositories)
- [Letta Skill Learning](https://www.letta.com/blog/skill-learning)
- [Letta Learning SDK](https://github.com/letta-ai/learning-sdk)
- [Letta AI Memory SDK](https://github.com/letta-ai/ai-memory-sdk)
- [Greptile Pricing](https://www.greptile.com/pricing)
- [Greptile's Biggest Update](https://www.greptile.com/blog/greptile-update)
- [Aider Repository Map](https://aider.chat/docs/repomap.html)
- [Building a Better Repository Map with Tree-sitter (Aider)](https://aider.chat/2023/10/22/repomap.html)
- [CodeRLM](https://github.com/JaredStewart/coderlm)
- [OpenViking](https://github.com/volcengine/OpenViking)
- [OpenViking Website](https://openviking.ai/)
- [Mem0](https://mem0.ai/)
- [Mem0 Research](https://mem0.ai/research)
- [Mem0 Paper](https://arxiv.org/abs/2504.19413)
- [Claude Context MCP (Zilliz)](https://github.com/zilliztech/claude-context)
- [Letta vs Mem0 vs Zep Comparison](https://medium.com/asymptotic-spaghetti-integration/from-beta-to-battle-tested-picking-between-letta-mem0-zep-for-ai-memory-6850ca8703d1)
- [ODEI vs Mem0 vs Zep 2026](https://dev.to/zer0h1ro/odei-vs-mem0-vs-zep-choosing-agent-memory-architecture-in-2026-15c0)
- [Top 10 AI Memory Products 2026](https://medium.com/@bumurzaqov2/top-10-ai-memory-products-2026-09d7900b5ab1)
- [Best AI Code Review Tools 2026](https://dev.to/heraldofsolace/the-best-ai-code-review-tools-of-2026-2mb3)
- [Survey of AI Agent Memory Frameworks](https://www.graphlit.com/blog/survey-of-ai-agent-memory-frameworks)
- [CodeRAG with Dependency Graph](https://medium.com/@shsax/how-i-built-coderag-with-dependency-graph-using-tree-sitter-0a71867059ae)
