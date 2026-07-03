# Repo Expert Agents — Architecture Overview

A CLI framework that creates **persistent AI agents** (OpenViking for storage/retrieval + any OpenAI-compatible chat endpoint, defaulting to local Ollama) that act as long-term memory for git repositories. Unlike IDE tools that forget between sessions, these agents accumulate and refine knowledge over time.

---

## Hexagonal Architecture: Functional Core, Imperative Shell

The codebase follows the **Ports and Adapters** (hexagonal) pattern:

- **Core** (`src/core/`) — pure functions with no side effects; the domain logic
- **Ports** (`src/ports/`) — TypeScript interfaces that define what the core needs from the outside world
- **Shell / Adapters** (`src/shell/`, `src/shell/adapters/`) — concrete implementations of ports; all I/O lives here

```mermaid
graph TB
    subgraph "External Systems"
        FS["Filesystem (node:fs)"]
        GIT["Git (execFileSync)"]
        VIKING["OpenViking server (HTTP)"]
        LLM["OpenAI-compatible LLM endpoint\n(Ollama by default)"]
    end

    subgraph "src/shell/adapters/ — Port Implementations"
        NFS["NodeFilesystem\nimplements FileSystemPort"]
        NGIT["NodeGit\nimplements GitPort"]
        VAA["VikingAdminAdapter\nimplements AdminPort"]
    end

    subgraph "src/ports/ — Interfaces (boundary)"
        FP["FileSystemPort"]
        GP["GitPort"]
        AP["AdminPort"]
    end

    subgraph "src/core/ — Pure Functions (no I/O)"
        CORE["chunker · filter · sync\nstate · config · prompts\nonboard · export · watch"]
    end

    subgraph "src/shell/ — Imperative Shell"
        SHELL["config-loader\nfile-collector\nstate-store\nagent-factory\nviking-provider · llm-client"]
    end

    subgraph "User Interfaces"
        CLI["repo-expert CLI"]
        MCP["MCP Server (stdio)"]
    end

    CLI --> SHELL
    MCP --> SHELL
    SHELL --> CORE
    SHELL --> NFS
    SHELL --> NGIT
    SHELL --> VAA
    NFS -->|implements| FP
    NGIT -->|implements| GP
    VAA -->|implements| AP
    NFS --> FS
    NGIT --> GIT
    VAA --> VIKING
    SHELL --> LLM
    CORE -.->|depends on types only| FP
    CORE -.->|depends on types only| GP
    CORE -.->|depends on types only| AP
```

---

## Layer Rules

### `src/core/` — Pure Functions

- **Can import**: other `../core/*` modules, `zod/v4`, standard type-only utilities
- **Cannot import**: `../shell/*`, `../ports/*` (implementations), `node:fs`, `node:child_process`, `fast-glob`, or any module with I/O side effects
- Every function must be deterministic: same inputs always produce the same outputs
- No `console.log`, no network calls, no filesystem access

### `src/ports/` — Interfaces Only

- **Contains**: TypeScript `interface` and `type` declarations only
- **Cannot contain**: `class` declarations, function implementations, any runtime code
- These files define the contract between core and the outside world

### `src/shell/` and `src/shell/adapters/` — Imperative Shell

- **Can import**: anything — core, ports, Node.js built-ins, third-party SDKs
- Adapters implement port interfaces and translate between the domain and external APIs
- All side effects (filesystem, network, environment variables, process spawning) live here

---

## Enforcement

Architecture rules are enforced at two levels:

1. **Compile-time (ESLint)** — `eslint.config.mjs` has a `no-restricted-imports` rule on `src/core/**/*.ts` blocking imports of `../shell/*`, `node:fs*`, and `node:child_process`
2. **Test-time (Vitest)** — `src/__tests__/architecture.test.ts` uses `node:fs` to scan source files and assert no violations exist

Run both checks before merging:

```bash
pnpm lint   # ESLint catches violations at the import level
pnpm test   # architecture.test.ts catches violations at the file content level
```

---

## Key Files

| Concept | File |
|---|---|
| Port: filesystem | `src/ports/filesystem.ts` |
| Port: git | `src/ports/git.ts` |
| Port: admin | `src/ports/admin.ts` |
| Adapter: filesystem | `src/shell/adapters/node-filesystem.ts` |
| Adapter: git | `src/shell/adapters/node-git.ts` |
| Adapter: admin | `src/shell/adapters/viking-admin-adapter.ts` |
| Provider port | `src/ports/agent-provider.ts` |
| Viking provider | `src/shell/viking-provider.ts` |
| LLM client | `src/shell/llm-client.ts` |
| Tree-sitter chunker | `src/core/tree-sitter-chunker.ts` |
| Architecture tests | `src/__tests__/architecture.test.ts` |

---

## Data Flow

```
 ┌──────────────────────────────────────────────────────────────────┐
 │                         LIFECYCLE                                │
 │                                                                  │
 │  config.yaml          setup           OpenViking + LLM endpoint  │
 │  ┌──────────┐    ┌─────────────┐    ┌─────────────────────┐     │
 │  │ repos:   │───▶│ collect     │───▶│  Agent per repo     │     │
 │  │  mobile  │    │ files       │    │  ┌───────────────┐  │     │
 │  │  backend │    │ chunk       │    │  │ Core Memory   │  │     │
 │  │  etl     │    │ (raw/       │    │  │ (self-updated)│  │     │
 │  └──────────┘    │ tree-sitter)│    │  ├───────────────┤  │     │
 │                  │ load as     │    │  │ Archival Mem  │  │     │
 │                  │ passages    │    │  │ (vector store)│  │     │
 │                  │ bootstrap   │    │  ├───────────────┤  │     │
 │                  └─────────────┘    │  │ Recall Memory │  │     │
 │  ┌─────────────────┐                │  │ (conv history)│  │     │
 │  │ detect changed  │───▶ delete old │  └───────────────┘  │     │
 │  │ files since     │    passages,   │                     │     │
 │  │ last commit     │    insert new  └─────────────────────┘     │
 │  └─────────────────┘                                            │
 └──────────────────────────────────────────────────────────────────┘
```

The chunk step supports two strategies, selected via `config.defaults.chunking`: **`tree-sitter`** (default, symbol-boundary chunking for `.ts`/`.tsx`/`.js`/`.jsx`) and **`raw`** (~2KB text splits on paragraph boundaries). Non-JS/TS file types automatically fall back to raw chunking when using tree-sitter. Implementation lives in `src/core/tree-sitter-chunker.ts`.

---

## CLI Commands

```
repo-expert
 ├── setup [--repo]       Create agents, load files, bootstrap
 ├── ask <repo> <q>       Query a single agent
 │   └── --all            Broadcast to all agents
 ├── sync [--full]        Incremental sync via git diff
 ├── reconcile [--fix]    Compare local state vs the provider, detect/fix drift
 ├── watch                Poll git HEAD, auto-sync on new commits
 ├── list                 Show agents and passage counts
 ├── status               Memory stats and health per agent
 ├── export               Dump agent memory to markdown
 ├── onboard <repo>       Guided codebase walkthrough
 └── destroy [--repo]     Delete agents
```
