# Repo Expert Agents

Persistent AI agents that serve as institutional memory for git repositories, built on [Letta Cloud](https://docs.letta.com).

Unlike IDE tools that forget between sessions, these agents accumulate knowledge over time — refining their understanding of architecture, conventions, and cross-repo relationships through every interaction.

## Prerequisites

- Node.js 18+
- [pnpm](https://pnpm.io/)
- A [Letta Cloud](https://app.letta.com/) account and API key

## Quick Start

```bash
pnpm install
pnpm repo-expert init    # guided setup: API key + repo config
pnpm repo-expert setup   # create agents
pnpm repo-expert doctor  # verify API/config/state/git health
pnpm repo-expert self-check
pnpm repo-expert onboard my-app
pnpm repo-expert ask my-app "How does authentication work?"
```

Non-interactive bootstrap:

```bash
pnpm repo-expert --no-input init --api-key "$LETTA_API_KEY" --repo-path ~/repos/my-app --yes
pnpm repo-expert config lint --json
pnpm repo-expert setup --reindex --json
pnpm repo-expert sync --dry-run --json
```

## Manual Setup

If you prefer manual configuration over `init`:

```bash
pnpm install

# Configure your API key
cp .env.example .env   # or create .env with: LETTA_API_KEY=your-key-here

# Configure your repos
cp config.example.yaml config.yaml
# Edit config.yaml with your repo paths, extensions, and descriptions
```

## Usage

```bash
# Create agents from config
pnpm repo-expert setup
pnpm repo-expert setup --repo my-app    # single repo
pnpm repo-expert setup --resume         # resume partial setup
pnpm repo-expert setup --reindex        # force full re-index

# Ask questions
pnpm repo-expert ask my-app "How does authentication work?"
pnpm repo-expert ask --all "What's the API contract for user creation?"
pnpm repo-expert ask -i                 # interactive REPL
pnpm repo-expert ask -i my-app          # REPL with default agent

# Sync after code changes
pnpm repo-expert sync                   # incremental (git diff)
pnpm repo-expert sync --full            # full re-index
pnpm repo-expert sync --repo my-app

# Inspect
pnpm repo-expert list                   # list agents
pnpm repo-expert status                 # memory stats and health
pnpm repo-expert self-check             # node/pnpm/dependency health
pnpm repo-expert config lint            # validate config.yaml
pnpm repo-expert export --repo my-app   # dump memory to markdown

# Onboarding
pnpm repo-expert onboard my-app         # guided codebase walkthrough

# Cleanup
pnpm repo-expert destroy                # delete all agents (with confirmation)
pnpm repo-expert destroy --repo my-app

# Shell completions
pnpm repo-expert completion zsh > ~/.zsh/completions/_repo-expert
pnpm repo-expert completion fish --install-dir ~/.config/fish/completions
```

## Configuration

See [`config.example.yaml`](config.example.yaml) for all options. Minimal example:

```yaml
letta:
  model: openai/gpt-4.1
  embedding: openai/text-embedding-3-small

repos:
  my-app:
    path: ~/repos/my-app
    description: "React Native mobile app"
    extensions: [.ts, .tsx, .js, .json]
    ignore_dirs: [node_modules, .git, dist]
```

Paths support `~` (home directory) and relative paths. Tags enable cross-agent discovery when using `--all`.

## How It Works

Each repo gets a Letta agent with three-tier memory:

- **Core memory** (always in context): persona, architecture overview, coding conventions — self-updated by the agent over time
- **Archival memory** (vector store): source files as searchable passages
- **Recall memory** (conversation history): institutional memory of past interactions

On `setup`, the agent loads all matching files, then bootstraps by analyzing the codebase and populating its core memory blocks. On `sync`, only changed files (via `git diff`) are re-indexed.

## Development

```bash
pnpm build             # build dist artifacts
pnpm changeset         # add release note entry
pnpm version-packages  # apply version bumps/changelogs
pnpm release           # publish with changesets
pnpm test              # run tests
pnpm tsx src/cli.ts    # run CLI directly
```

Optional command telemetry (JSONL):

```bash
REPO_EXPERT_TELEMETRY_PATH=.repo-expert-telemetry.jsonl pnpm repo-expert setup --json
```
