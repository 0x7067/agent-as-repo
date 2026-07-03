# Single-Provider Convergence Plan — Viking as the One Path

Date: 2026-07-03
Status: approved
Decision owner: repo owner

## Decision

Collapse the dual-provider architecture (Letta Cloud + OpenViking) into a **single path: OpenViking for storage/retrieval + a configurable OpenAI-compatible LLM endpoint, defaulting to local Ollama**. Letta is removed entirely. No migration/back-compat code is kept — the project has no live deployments, so old configs and state are simply invalid.

### Why

- Letta self-hosted is deprecated by the vendor (Docker surface unmaintained as of mid-2026); Letta Cloud contradicts the local-first goal.
- The Viking path already contains the whole client-side runtime: a tool-calling agent loop (`openrouter-client.ts`), block storage (`block-storage.ts`), retry/circuit-breaker HTTP client (`viking-http.ts`). OpenViking contributes storage + semantic search; the rest is ours.
- The LLM loop speaks the OpenAI chat-completions protocol, so pointing it at Ollama (`http://localhost:11434/v1`) instead of OpenRouter makes the whole stack local on Apple Silicon with a one-line config default. OpenRouter/any cloud endpoint remains available by setting `base_url`.

### Known risk (accepted)

OpenViking is pre-1.0 (v0.4.x), AGPL-3.0, releases with breaking changes frequently. Accepted by the owner. The `AgentProvider` port stays as the seam so a future swap (e.g. sqlite-vec homegrown store) only replaces the provider implementation.

## Target design

### Config (`config.yaml`)

Single provider shape, no discriminated union, no `type` field:

```yaml
provider:
  model: qwen3-coder:30b                  # chat model id as the endpoint knows it
  base_url: http://localhost:11434/v1     # optional; default Ollama local
  fallback_models: []                     # optional; tried in order after `model`
  viking_url: http://localhost:1933       # optional; default OpenViking local
defaults: ...   # unchanged
repos: ...      # unchanged
```

TS shape (`src/core/types.ts`): `ProviderConfig = { model: string; baseUrl: string; fallbackModels: string[]; vikingUrl: string }` — defaults applied in `parseConfig`. The legacy top-level `letta:` migration in `config.ts` is deleted; a config containing `provider.type`, `openrouter_model`, or a `letta:` block fails validation with a message pointing at the new shape (one zod refinement, not a migration path).

### Env vars

- `LLM_API_KEY` — optional; sent as `Authorization: Bearer` when set. Required in practice only for remote endpoints (OpenRouter etc.). Ollama needs none.
- `VIKING_API_KEY` — optional, unchanged. `VIKING_URL` env override removed in favor of config `viking_url` (config wins; keep env override only if trivially cheap).
- Deleted: `LETTA_API_KEY`, `OPENROUTER_API_KEY`, `PROVIDER_TYPE`.

### Ports (`src/ports/agent-provider.ts`)

- Remove `enableSleeptime` (Letta-only; Viking impl was a no-op).
- Remove `embedding` from `CreateAgentParams` (Letta-only; Viking ignores it — OpenViking owns embeddings via `ov.conf`).
- Everything else unchanged. `AdminPort` unchanged.
- Delete the `src/shell/provider.ts` re-export shim; all imports go to `../ports/agent-provider.js`.

### Shell

- `openrouter-client.ts` → rename to `llm-client.ts`: `callOpenRouter` → `callChatCompletions(baseUrl, apiKey?, ...)`; `toolCallingLoop` unchanged in shape. Default base URL `http://localhost:11434/v1`; Bearer header only when an API key is provided.
- `viking-provider.ts`: constructed with the llm-client config (baseUrl, apiKey, model + fallbackModels); drop `enableSleeptime`; otherwise unchanged.
- Delete: `letta-provider.ts`, `adapters/letta-admin-adapter.ts` (and tests), `@letta-ai/letta-client` dependency.
- `block-storage.ts`, `openviking-paths.ts`, `viking-http.ts`, `viking-admin-adapter.ts`: unchanged.
- `doctor.ts`: single-path checks — config valid, viking reachable, LLM endpoint reachable (`GET {base_url}/models`), `LLM_API_KEY` warning only when `base_url` is non-local. Delete `detectProviderType` / `expectedApiKeyEnv` branching.
- `init.ts` wizard: no provider question; prompts for model + base_url (both with the local defaults) and repo scan as today.

### CLI (`src/cli.ts`)

- `createProvider`: single construction path, no branching.
- Delete the `sleeptime` command.
- `setup`: single `modelOptions` shape (no `embedding`, no `fastModel`).
- `mcp-install`/`mcp-check`: server entry renamed `letta` → `repo-expert`; env written: `LLM_API_KEY` (if set), no `PROVIDER_TYPE`.
- `FakeProvider` in cli tests: drop `enableSleeptime`.

### MCP server (`src/mcp-server.ts`)

Single runtime, plain agent IDs (no `letta:`/`viking:` prefixes), 9 provider-neutral tools:

`agent_list`, `agent_get`, `agent_call` (was letta_send_message / agent_call), `agent_get_core_memory`, `agent_search_archival`, `agent_insert_passage`, `agent_delete_passage`, `agent_update_block`.

Delete: `PROVIDERS`, `buildLettaRuntime`, `buildProviderRegistry`, `selectLegacyRuntime`, namespaced-ID parsing, all `letta_*` tool registrations. Update `src/mcp-server.directives.md` to the new tool list. `package.json` bin `letta-tools` → `repo-expert-mcp` (SEA config `sea-config-mcp.json` output name follows).

### Core cleanups

- `mcp-config.ts`: single provider config (no `preferredProvider`, no letta/viking sub-objects); entry name `repo-expert`.
- `init.ts` (core): single YAML shape emitted.
- `prompts.ts`: remove `send_message_to_agents_matching_tags` (Letta-only). Keep `archival_memory_search` and `memory_replace` — the Viking loop defines these tools itself.

### Deletions elsewhere

- `spikes/provider-parity-stress.ts` + `provider:parity-stress` script (compares two providers — obsolete).
- `scripts/generate-mcp-config.ts` (stale Letta-only duplicate of `mcp-install`).
- `config-viking.yaml` (merged into `config.example.yaml`, which becomes the single example).

### Docs

- `README.md`: single-path quickstart (Ollama + OpenViking prerequisites), command table minus `sleeptime`, new config example, new env vars.
- `docs/mcp-setup.md`: new tool names, new server entry name.
- `CLAUDE.md`: remove Letta SDK import rule, "never override Letta system prompt", `LETTA_API_KEY` reference; update key-files list (`src/shell/provider.ts` → `src/ports/agent-provider.ts`); update pre-PR checklist item 5.
- Historical docs (`docs/research-audit.md`, `feasibility-analysis.md`, `idea.md`, `phase-0-findings.md`, older plans) stay untouched.

## Execution

Two sequential waves (the suite must stay green at every commit, and wave 2 depends on wave 1's final shape):

1. **Wave 1 — src migration** (single agent, TDD): ports → shell → core → cli → mcp-server, deleting Letta code and generalizing the LLM client. All tests green, lint + typecheck clean. Commits on `claude/repo-experts-agent-path-uqmmnt`.
2. **Wave 2 — docs, examples, packaging polish** (single agent): README, CLAUDE.md, mcp-setup.md, config.example.yaml, directives file, package.json bin/scripts sanity, delete stale scripts/spike. Final `pnpm sanity`.

Out of scope (future work, tracked separately): swapping OpenViking for an embedded sqlite-vec store behind the same `AgentProvider` port; a summarize-on-sync job replacing sleeptime consolidation.
