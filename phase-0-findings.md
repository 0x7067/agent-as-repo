# Phase 0 Findings — Repo Expert Agents

## Executive Summary

- **Go/no-go: GO.** All 5 spikes passed. The Letta Cloud SDK supports every capability the framework needs.
- **SDK docs are unreliable.** Class names, constructor params, method signatures, and default tool sets all differ from official documentation. Pin v1.7.8 and trust only verified signatures below.
- **Retrieval works — but only with explicit setup.** `archival_memory_search` is not a default tool, files must be chunked (~2KB), and the agent must be told not to filter by tags.
- **Ingestion speed is acceptable.** p=20 concurrency yields ~126ms/passage with no rate limiting. 1K files in ~2 min, 5K in ~10 min.
- **Bootstrap works.** Agents self-populate accurate architecture and conventions summaries from archival memory in a single prompt.

## Spike Results

| # | Spike | Status | Key Finding |
|---|-------|--------|-------------|
| 1 | SDK Smoke Test | PASSED | Full CRUD cycle works: agent creation, passage insert/delete, message send, block read/update |
| 2 | Ingestion Speed | PASSED | p=20 → 126ms/passage at 1K scale. Sequential is 16x slower (2071ms/passage). No rate limits hit. |
| 3 | Passage Lifecycle | PASSED | Create → text search → delete → re-create cycle works. Passage IDs stable for deletion. Updated content immediately searchable. |
| 4 | Retrieval Quality | PASSED | 0% hit rate initially → 100% after three fixes: attach `archival_memory_search`, chunk files, suppress tag filtering. |
| 5 | Bootstrap Viability | PASSED | Agent produced accurate 2500-char architecture summary and 2200-char conventions summary from 20 archival chunks. |

## SDK Corrections

The original `idea.md` and `feasibility-analysis.md` contain incorrect SDK references. The table below shows verified signatures against `@letta-ai/letta-client@1.7.8`.

| Spec Assumed | Verified Reality |
|---|---|
| `import { LettaClient } from "@letta-ai/letta-client"` | `import Letta from "@letta-ai/letta-client"` (default export, class is `Letta`) |
| `new LettaClient({ token: "..." })` | `new Letta({ apiKey: "..." })` or `new Letta()` (auto-reads `LETTA_API_KEY` env var) |
| `memoryBlocks: [...]` | `memory_blocks: [...]` (snake_case in types) |
| `blocks.retrieve(agentId, "label")` | `blocks.retrieve("label", { agent_id: agentId })` |
| `blocks.modify(agentId, "label", { value })` | `blocks.update("label", { agent_id: agentId, value })` |
| `passages.delete(agentId, passageId)` | `passages.delete(passageId, { agent_id: agentId })` |
| "base tools included by default" | Only 3 defaults: `conversation_search`, `memory_insert`, `memory_replace`. `archival_memory_search` must be explicitly attached. |
| `passages.create()` returns a Passage | Returns `Array<Passage>` — use `result[0].id` |
| `passages.search()` returns array | Returns `{ count, results: Array<{ id, content, timestamp }> }` |

## Critical Discoveries

### 1. archival_memory_search is not a default tool

- **Expected**: Base tools include archival memory search (per Letta docs and feasibility analysis).
- **Found**: Default agent tools are only `conversation_search`, `memory_insert`, `memory_replace`. Without explicit attachment, the agent searches conversation history instead of passages.
- **Action**: Always pass `tools: ["archival_memory_search"]` in `agents.create()`.

### 2. Agent adds spurious tag filters to archival search

- **Expected**: Agent searches archival memory with just a query string.
- **Found**: The agent speculatively adds `tags: ["architecture", "planning", ...]` to search calls. Since passages have no tags, every search returns empty.
- **Action**: Include in persona block: "When using archival_memory_search, do NOT pass tags — just use the query parameter."

### 3. Whole-file passages produce poor retrieval

- **Expected**: Loading full files as single passages would work for vector search.
- **Found**: Direct API search (`passages.search`) returns results for both whole-file and chunked passages. But chunked passages (~2KB) return more relevant, targeted results. The agent's built-in `archival_memory_search` tool performs significantly better with smaller chunks.
- **Action**: Chunk files at ~2000 characters, splitting on double newlines. Prefix each chunk with `FILE: <path>` (and `(continued)` for subsequent chunks).

### 4. Custom system prompts break memory tool usage

- **Expected**: A custom `system` prompt would supplement the default behavior.
- **Found**: Setting the `system` parameter replaces Letta's entire default system prompt, which includes critical instructions for using memory tools. Agents with custom system prompts failed to use archival search correctly.
- **Action**: Do not override the `system` parameter. Use the `persona` memory block for agent-specific instructions instead.

### 5. Ingestion is I/O-bound, not rate-limited

- **Expected**: Letta Cloud would rate-limit concurrent passage creation.
- **Found**: p=20 concurrency works with no errors or throttling. Per-passage latency drops from 2071ms (sequential) to 126ms (p=20 at 1K scale). The bottleneck is network round-trip time, not server-side limits.
- **Action**: Default to p=20 concurrency for passage ingestion. Monitor for rate limits at higher volumes (5K+) but don't preemptively throttle.

### 6. conversation_search vs archival_memory_search confusion

- **Expected**: Agent would know which memory tier to search.
- **Found**: Without guidance, the agent defaults to `conversation_search` (chat history) for all "search my memory" queries, never touching archival passages.
- **Action**: The persona block must explicitly distinguish: "Source files are in archival memory. Use archival_memory_search for codebase questions."

## Revised Implementation Guidance

### Agent Creation Template

```typescript
const agent = await client.agents.create({
  name: `${repoName}-expert`,
  model: "openai/gpt-4.1",
  embedding: "openai/text-embedding-3-small",
  tools: ["archival_memory_search"],
  memory_blocks: [
    {
      label: "persona",
      value: [
        `I am an expert on the ${repoName} repository. ${repoDescription}`,
        "All source files are stored in my archival memory.",
        "I always use archival_memory_search to answer codebase questions.",
        "When using archival_memory_search, do NOT pass tags — just use the query parameter.",
        "I never rely on general knowledge — only on what I find in archival memory.",
      ].join("\n"),
      limit: 5000,
    },
    { label: "architecture", value: "Not yet analyzed.", limit: 5000 },
    { label: "conventions", value: "Not yet analyzed.", limit: 5000 },
  ],
  tags: ["repo-expert", ...repoTags],
});
```

### File Chunking Strategy

- Split on double newlines (`\n\n+`)
- Target ~2000 characters per chunk
- Prefix: `FILE: <relative-path>` on first chunk, `FILE: <relative-path> (continued)` on subsequent
- Skip files > 50KB (configurable)
- Skip binary files, node_modules, build artifacts

### Ingestion Settings

- Concurrency: p=20 (no rate limiting observed)
- Expected throughput: ~126ms/passage at scale
- Fallback: if >500 files changed in sync, do full re-index

### Memory Block Configuration

- 3 blocks: `persona`, `architecture`, `conventions`
- Limit: 5000 characters each
- Do not add `human` block unless needed for user-specific context

### Passage Management

- Store `{ filePath: passageId }` map in state file
- Passages return `Array<Passage>` — always access `result[0].id`
- Delete via `passages.delete(passageId, { agent_id })` — passage ID is first arg
- Text search: `passages.list(agentId, { search: "term" })`
- Semantic search: `passages.search(agentId, { query: "term" })`

### Bootstrap Prompts

Two-step bootstrap after loading passages:

1. **Architecture**: "Analyze the codebase in your archival memory. Search for architecture, structure, and patterns. Update your 'architecture' block with a summary under 4000 chars."
2. **Conventions**: "Search for coding conventions, dependencies, and API patterns. Update your 'conventions' block with a summary under 4000 chars."

Both prompts must include: "When using archival_memory_search, do NOT pass tags."

## Open Questions

1. **Higher concurrency**: p=20 was the max tested. Would p=40 or p=50 be faster without hitting limits? Worth testing during Phase 1 if ingestion speed is a concern.
2. **Chunking quality**: The simple double-newline chunker works but is naive. Tree-sitter AST chunking (Phase 3) would likely improve retrieval for code files. Worth benchmarking during Phase 2.
3. **Passage tags**: We told the agent not to use tags. But if we tagged passages by file type or directory, the agent could use them for filtered search. Worth exploring once basic retrieval is solid.
4. **Cross-agent communication**: Not tested in Phase 0. The tools exist (`send_message_to_agents_matching_tags`, `send_message_to_agent_and_wait_for_reply`) but need verification with multi-agent setup.
5. **Cost**: No Letta Cloud pricing observed. 1K passages × 20 chunks = ~50 API calls per spike. Need to monitor usage at real-repo scale.
