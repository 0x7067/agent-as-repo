# Repo Expert Agents — Architecture Overview

A CLI framework that creates **persistent AI agents** (on Letta Cloud) that act as long-term memory for git repositories. Unlike IDE tools that forget between sessions, these agents accumulate and refine knowledge over time.

---

## Architecture Diagram

```mermaid
graph TB
    subgraph "User Interfaces"
        CLI["repo-expert CLI"]
        MCP["MCP Server (stdio)"]
        API["Other AI tools<br/>(Claude Code, Codex)"]
    end

    API --> MCP
    CLI --> Shell
    MCP --> Shell

    subgraph "src/shell/ — Imperative Shell (I/O boundary)"
        Shell["config-loader<br/>file-collector<br/>state-store<br/>agent-factory<br/>letta-provider"]
    end

    subgraph "src/core/ — Pure Functions (no side effects)"
        Core["chunker · filter · sync<br/>state · config · prompts<br/>onboard · export · watch"]
    end

    Shell --> Core
    Shell --> Letta

    subgraph "Letta Cloud"
        direction TB
        A1["Agent: mobile<br/>🏷 mobile, frontend"]
        A2["Agent: backend<br/>🏷 backend, api"]
        A3["Agent: data-etl<br/>🏷 data, integration"]

        subgraph "Per-Agent Memory"
            CM["Core Memory (always in context)<br/>persona · architecture · conventions"]
            AM["Archival Memory (vector store)<br/>source files as searchable passages"]
            RM["Recall Memory<br/>conversation history"]
        end

        A1 -.->|tag-based discovery| A2
        A2 -.->|cross-agent messaging| A3
    end

    subgraph "Git Repos (local filesystem)"
        R1["~/repos/mobile-app"]
        R2["~/repos/backend"]
        R3["~/repos/data-etl"]
    end

    Shell -->|"collect files<br/>git diff"| R1
    Shell -->|"collect files<br/>git diff"| R2
    Shell -->|"collect files<br/>git diff"| R3
```

---

## Data Flow

```
 ┌──────────────────────────────────────────────────────────────────┐
 │                         LIFECYCLE                                │
 │                                                                  │
 │  config.yaml          setup              Letta Cloud             │
 │  ┌──────────┐    ┌─────────────┐    ┌─────────────────────┐     │
 │  │ repos:   │───▶│ collect     │───▶│  Agent per repo     │     │
 │  │  mobile  │    │ files       │    │  ┌───────────────┐  │     │
 │  │  backend │    │ chunk ~2KB  │    │  │ Core Memory   │  │     │
 │  │  etl     │    │ load as     │    │  │ (self-updated)│  │     │
 │  └──────────┘    │ passages    │    │  ├───────────────┤  │     │
 │                  │ bootstrap   │    │  │ Archival Mem  │  │     │
 │                  └─────────────┘    │  │ (vector store)│  │     │
 │                                     │  ├───────────────┤  │     │
 │       sync (git diff)               │  │ Recall Memory │  │     │
 │  ┌─────────────────┐                │  │ (conv history)│  │     │
 │  │ detect changed  │───▶ delete old │  └───────────────┘  │     │
 │  │ files since     │    passages,   │                     │     │
 │  │ last commit     │    insert new  └─────────────────────┘     │
 │  └─────────────────┘                                            │
 │                                                                  │
 │       ask                                                        │
 │  ┌─────────────────┐     ┌─────────────────┐                    │
 │  │ "How does auth  │────▶│ Agent searches   │──▶ answer         │
 │  │  work?"         │     │ archival + core  │                    │
 │  └─────────────────┘     │ memory, reasons  │                    │
 │                          └─────────────────┘                    │
 │       ask --all                                                  │
 │  ┌─────────────────┐     ┌──────┐ ┌──────┐ ┌──────┐            │
 │  │ "What's the API │────▶│ A    │ │ B    │ │ C    │ fan-out    │
 │  │  contract?"     │     │      │ │      │ │      │            │
 │  └─────────────────┘     └──┬───┘ └──┬───┘ └──┬───┘            │
 │                             └────┬────┘────────┘                │
 │                                  ▼                               │
 │                          combined answers                        │
 └──────────────────────────────────────────────────────────────────┘
```

---

## CLI Commands

```
repo-expert
 ├── setup [--repo]       Create agents, load files, bootstrap
 ├── ask <repo> <q>       Query a single agent
 │   ├── --all            Broadcast to all agents
 │   └── -i               Interactive REPL
 ├── sync [--full]        Incremental sync via git diff
 ├── watch                Poll git HEAD, auto-sync on new commits
 ├── list                 Show agents and passage counts
 ├── status               Memory stats and health per agent
 ├── export               Dump agent memory to markdown
 ├── onboard <repo>       Guided codebase walkthrough
 └── destroy [--repo]     Delete agents from Letta Cloud
```

---

## Key Design Decisions

- **Functional core, imperative shell** — `src/core/` has pure functions (no I/O), `src/shell/` handles all side effects
- **Provider abstraction** — `AgentProvider` interface decouples from Letta SDK; `LettaProvider` is the current adapter
- **Three-tier memory** — core (always in context, self-updating), archival (vector-searchable source), recall (conversation history)
- **Tag-based discovery** — agents find each other via `["repo-expert", ...tags]`, no hardcoded IDs
- **Incremental sync** — `git diff` detects changes, only affected passages are re-indexed
- **Config-driven** — YAML config defines repos, one `setup` command creates everything
