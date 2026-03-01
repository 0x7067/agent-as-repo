# OpenViking + OpenRouter as Alternative AgentProvider

**Date:** 2026-03-01
**Status:** Implemented

## Overview

agent-as-repo previously depended on Letta as its sole agent runtime. This design adds OpenViking (context database) + OpenRouter (LLM gateway) as a parallel `AgentProvider` implementation, selectable per config. Letta remains available — repos can use either provider.

**OpenViking** is a context database, not an agent runtime. It provides filesystem-based storage with semantic search but no LLM inference.
**OpenRouter** provides an OpenAI-compatible chat completions API with function calling, supporting many models.

## Architecture

```
AgentProvider (interface — src/ports/agent-provider.ts)
├── LettaProvider        (existing — src/shell/letta-provider.ts)
└── VikingProvider (new) (src/shell/viking-provider.ts)
    ├── VikingHttpClient (src/shell/viking-http.ts)
    └── toolCallingLoop  (src/shell/openrouter-client.ts)
```

Config selects provider. All consumers see only `AgentProvider` — zero changes to shell modules beyond entry points.

## Storage Model (OpenViking)

Each agent maps to a resource tree:

```
viking://resources/{repoName}/
  manifest.json                    # { agentId, name, model, tags, tools, createdAt }
  blocks/
    persona                        # plain text
    architecture                   # plain text
    conventions                    # plain text
  passages/
    {passageId}.txt                # one per file chunk, semantically indexed
```

The `agentId` for VikingProvider is the repo name itself (e.g. `"myrepo"`), which is also the resource root URI segment.

Passage search uses `POST /api/v1/search/find` with `target_uri: "viking://resources/{repoName}/passages/"` to scope semantic search per repo.

## Chat Model (OpenRouter)

`sendMessage` implements a tool-calling loop:

1. Read blocks (persona, architecture, conventions) from OpenViking
2. Assemble system prompt via `buildPersona()` from `src/core/prompts.ts`
3. Define two tools as OpenAI function schemas:
   - `archival_memory_search` `{ query: string }` → OpenViking semantic search
   - `memory_replace` `{ label: string, value: string }` → `updateBlock` on OpenViking
4. Call OpenRouter (`POST /chat/completions`) with system + user message + tools
5. While response has `tool_calls`: execute tools, feed results back, call again
6. Return final assistant message text

`overrideModel` → OpenRouter `model` field. `maxSteps` → caps loop iterations.

## Method Mapping

| AgentProvider method | VikingProvider implementation |
|---|---|
| `createAgent` | Write manifest, create directory tree, write initial blocks |
| `deleteAgent` | `deleteResource` on `viking://resources/{repoName}/` |
| `enableSleeptime` | No-op (not applicable to stateless HTTP provider) |
| `storePassage` | `writeFile` with UUID filename under `passages/` |
| `deletePassage` | `deleteFile` for the passage file |
| `listPassages` | `listDirectory` on `passages/` + batch `readFile` for content |
| `getBlock` | `readFile` for `blocks/{label}` |
| `updateBlock` | `writeFile` for `blocks/{label}` |
| `sendMessage` | Tool-calling loop via OpenRouter |

## Config Format

### New format (`provider:` key)

```yaml
provider:
  type: letta
  model: letta-free
  embedding: letta:text-embedding-ada-002
```

```yaml
provider:
  type: viking
  openrouter_model: openai/gpt-4o-mini
  viking_url: http://localhost:1933   # optional, defaults to http://localhost:1933
```

### Old format (backwards-compatible migration)

```yaml
letta:
  model: letta-free
  embedding: letta:text-embedding-ada-002
```

Old configs are automatically migrated at parse time to `provider: { type: "letta", ... }`.

### TypeScript types

```typescript
export type ProviderConfig =
  | { type: "letta"; model: string; embedding: string; fastModel?: string }
  | { type: "viking"; openrouterModel: string; vikingUrl?: string };

export interface Config {
  provider: ProviderConfig;
  defaults: { /* unchanged */ };
  repos: Record<string, RepoConfig>;
}
```

### Environment variables

| Variable | Provider | Description |
|---|---|---|
| `LETTA_API_KEY` | letta | Required for Letta provider |
| `OPENROUTER_API_KEY` | viking | Required for OpenRouter LLM calls |
| `VIKING_URL` | viking | Optional. Defaults to `http://localhost:1933` |
| `VIKING_API_KEY` | viking | Optional. Auth for OpenViking if needed |

## Files Created

| File | Purpose |
|---|---|
| `src/shell/viking-http.ts` | `VikingHttpClient` — thin fetch-based HTTP client for OpenViking REST API |
| `src/shell/viking-http.test.ts` | Unit tests with mocked fetch |
| `src/shell/openrouter-client.ts` | `callOpenRouter` + `toolCallingLoop` — OpenRouter chat completions |
| `src/shell/openrouter-client.test.ts` | Unit tests with mocked fetch |
| `src/shell/viking-provider.ts` | `VikingProvider implements AgentProvider` |
| `src/shell/viking-provider.test.ts` | Unit tests using mocked HTTP clients |
| `docs/plans/2026-03-01-viking-provider-design.md` | This document |

## Files Modified

| File | Change |
|---|---|
| `src/core/types.ts` | Added `ProviderConfig` type, replaced `letta` field with `provider` in `Config` |
| `src/core/config.ts` | Zod schema for both old and new provider config shapes; migration logic |
| `src/cli.ts` | `createProvider()` reads `config.provider`, returns `LettaProvider` or `VikingProvider` |
| `src/mcp-server.ts` | Same provider selection logic |

## Provider Selection Logic

```typescript
function createProvider(config: Config): AgentProvider {
  if (config.provider.type === "letta") {
    requireApiKey("LETTA_API_KEY");
    return new LettaProvider(new Letta({ timeout: 5 * 60 * 1000 }));
  } else {
    requireApiKey("OPENROUTER_API_KEY");
    const vikingUrl = process.env["VIKING_URL"] ?? "http://localhost:1933";
    const vikingApiKey = process.env["VIKING_API_KEY"];
    const openrouterApiKey = process.env["OPENROUTER_API_KEY"]!;
    const viking = new VikingHttpClient(vikingUrl, vikingApiKey);
    return new VikingProvider(viking, openrouterApiKey, config.provider.openrouterModel);
  }
}
```

## Design Decisions

**Why repo name as agentId?** OpenViking scopes storage by URI prefix. Using the repo name directly as the URI segment makes the storage layout deterministic and human-readable, without needing a separate mapping file.

**Why no retry logic in VikingProvider?** OpenViking is a local/internal service; transient network errors are less likely. The implementation can be extended with retry if needed.

**Why `enableSleeptime` is a no-op?** Sleeptime is a Letta-specific feature for background memory consolidation. OpenRouter is stateless — each request provides its own context from OpenViking blocks.

**Why `buildPersona()` reuse?** The core prompt-building logic is pure and provider-agnostic. VikingProvider uses the same `buildPersona()` from `src/core/prompts.ts` to maintain consistency in agent persona formatting.
