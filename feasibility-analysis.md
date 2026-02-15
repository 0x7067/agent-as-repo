# Feasibility Analysis: Repo Expert Agents on Letta Cloud

## 1. Letta SDK Reality Check

**Finding:** The spec's code examples use incorrect class names, parameter casing, and method paths. The actual TypeScript SDK exports `LettaClient` (not `Letta`), uses `{ token: "..." }` (not `{ apiKey: "..." }`), uses camelCase (`memoryBlocks`, `enableSleeptime`, `agentIds`) throughout, and archival memory insertion is via `client.agents.passages.create(agentId, { text })` — not `agents.archival_memory.create`. The env var convention is also likely `LETTA_API_KEY` mapped to the `token` constructor param.

**Verified methods and actual signatures:**

| Spec assumed | Actual SDK |
|---|---|
| `new Letta({ apiKey })` | `new LettaClient({ token })` |
| `agents.create({ memory_blocks, include_base_tools })` | `agents.create({ memoryBlocks, tools, model, embedding })` |
| `agents.archival_memory.create(id, { text })` | `agents.passages.create(id, { text })` |
| `agents.messages.create(id, { input: "..." })` | `agents.messages.create(id, { messages: [{ role, content }] })` |
| `agents.blocks.retrieve("label", { agent_id })` | `agents.blocks.retrieve(agentId, "label")` |
| `blocks.create({ label, value })` | Unverified in Node SDK — may use block templates |

`include_base_tools` and `block_ids` parameters were **not found** in any documentation reviewed. The tools array takes tool name strings (e.g., `["web_search", "run_code"]`), and base tools (archival memory search, memory edit) appear to be included by default.

**Verdict: PARTIALLY VALID**

**Recommendation:** Before writing any code, install `@letta-ai/letta-client`, inspect the TypeScript types (`node_modules/@letta-ai/letta-client/dist`), and write a small spike script that creates an agent, inserts a passage, queries it, and reads a block. This will take 30 minutes and prevent days of rework.

---

## 2. Archival Memory Limits

**Finding:** Letta's documentation does not publish explicit archival memory entry caps, ingestion rate limits, or storage pricing for Cloud. Archival memory is backed by vector search (pgvector on self-hosted, likely similar on Cloud). The `passages` API accepts text strings that get embedded and stored. There is no documented batch insertion API — entries are created one at a time via `agents.passages.create()`. For a repo with 5,000 source files, this means 5,000 sequential API calls at setup time. With typical API latency (100-300ms per call), initial setup for a single large repo could take **8-25 minutes**.

There are also no documented mechanisms to **update** an existing passage in-place. For incremental sync, you'd likely need to delete the old passage and insert the new one — but passage deletion by content/metadata is not clearly documented either.

**Verdict: UNVERIFIED**

**Recommendation:** Before committing to this architecture, run an empirical test: create an agent, insert 1,000 passages, measure ingestion time, then insert 5,000 and 10,000. Test retrieval quality at each scale. Also test passage deletion/update workflows. If ingestion is too slow or retrieval degrades at scale, consider chunking strategies (loading summaries instead of full files) or a hybrid approach where only key files go into archival memory.

---

## 3. Core Memory Block Strategy

**Finding:** Memory blocks support a `limit` field (character limit per block) and custom labels — so the proposed 5-block layout (persona, architecture, conventions, key_apis, dependencies) is structurally valid. Blocks can be created with `limit: 3000` or higher. The agent has built-in tools to read and modify its own blocks (`core_memory_replace`, `core_memory_append`). The "bootstrap then self-update" approach — where you prompt the agent to analyze its own archival memory and populate core blocks — is the intended Letta pattern.

However, 3,000 characters per block is **very tight** for meaningful codebase summaries. An "architecture" summary for a non-trivial repo could easily need 5,000-10,000 characters. The spec should test whether the block limit is a hard enforcement or a soft target for the agent's self-editing. Also, 5 blocks all in the context window means ~15,000 characters of core memory consuming the LLM's context alongside the system prompt, conversation history, and tool outputs. This could crowd out space for actual reasoning.

**Verdict: PARTIALLY VALID**

**Recommendation:** Increase `memory_block_limit` to 5,000 characters. Reduce to 3-4 blocks instead of 5 — combine `key_apis` and `conventions` into one block. Test whether the agent can reliably self-populate blocks via bootstrap prompts, and whether the populated blocks actually improve answer quality vs. just relying on archival search.

---

## 4. Cross-Agent Communication

**Finding:** All three claimed mechanisms are confirmed as real built-in Letta tools:

- `send_message_to_agent_and_wait_for_reply(message, other_agent_id)` — synchronous, blocking
- `send_message_to_agent_async(message, other_agent_id)` — fire-and-forget with reply receipt
- `send_message_to_agents_matching_all_tags(message, tags[])` — tag-based broadcast

Additionally, Letta now has a **Groups API** with four orchestration patterns (Supervisor-Worker, Dynamic Orchestrator, Sleeptime, Round-Robin) that is more powerful than the spec acknowledges. The tag-based broadcast tool means agents can discover peers by tags **without needing stored agent IDs**.

Critical caveats: (a) Letta docs recommend attaching only ONE of sync/async tools per agent, not both. (b) There is **no configurable timeout** on synchronous calls — if the target agent hangs, the caller blocks indefinitely. (c) Each synchronous cross-agent call adds at least one full LLM inference round-trip (2-10+ seconds).

**Verdict: CONFIRMED**

**Recommendation:** Use `send_message_to_agents_matching_all_tags` as the primary cross-agent mechanism (eliminates the need to store peer agent IDs in memory blocks). For Phase 4's "smart routing," use the Groups API's `DynamicManager` pattern instead of building a custom orchestrator. Add application-level timeouts around the REST API calls to handle stuck agents.

---

## 5. Incremental Sync Feasibility

**Finding:** The `git diff` approach for detecting changed files is sound — `git diff --name-only <commit>` reliably produces a list of changed paths. The problem is on the Letta side: there is **no documented way to update a passage in-place**. The `passages` API supports `create` and likely `delete`, but finding the specific passage to delete (by file path) requires either: (a) searching archival memory for the file path prefix and hoping you get exact matches, or (b) maintaining a local mapping of file paths to passage IDs in `.repo-expert-state.json`.

Option (b) is the only reliable approach, but it means the state file must track every passage ID for every file in every repo. For a repo with 5,000 files, that's 5,000 entries in the state file. This is manageable but adds complexity.

Large diffs (branch merges, rebases) could trigger thousands of passage deletions and re-insertions, which brings back the ingestion speed problem from Dimension 2.

**Verdict: PARTIALLY VALID**

**Recommendation:** Maintain a `{ filePath: passageId }` map in the state file. For sync, delete old passages by ID and insert new ones. Set a threshold (e.g., >500 changed files) above which incremental sync falls back to full re-index. Test whether passage deletion by ID is actually supported in the SDK — this is assumed but not verified.

---

## 6. Alternative Approaches

**Finding:** The proposed framework occupies an awkward middle ground. Here is how alternatives compare:

| Approach | Strengths over this project | Weaknesses |
|---|---|---|
| **Greptile** ($0.15/query API) | Production-ready, handles indexing/chunking/retrieval, no agent management overhead | No persistent memory, no cross-repo reasoning, no self-updating knowledge, vendor lock-in, pay-per-query at scale |
| **Local RAG** (ChromaDB/LanceDB + direct LLM calls) | Simpler, no Letta dependency, full control over embeddings/chunking, zero vendor risk | No agent memory/persona, no cross-agent communication, must build conversation management yourself |
| **Aider repo map** (tree-sitter + PageRank) | Better codebase compression than raw files, identifies important symbols/relationships, proven technique | Different purpose — optimizes for code editing context, not Q&A; doesn't provide persistent memory |
| **Cursor/Claude Code** (built-in indexing) | Already works, zero setup, better IDE integration, handles code editing too | No cross-repo reasoning, no persistent memory across sessions, no agent-to-agent communication, can't serve other AI agents |
| **MCP servers** (existing code search MCPs) | Integrates with Claude Code/Cursor directly | Read-only search, no memory, no reasoning layer, no cross-repo |

The unique value proposition of this project is: **persistent, self-updating memory + cross-repo agent communication + serves both humans and AI agents**. No existing tool offers all three. But the question is whether that combination is worth the complexity and Letta Cloud dependency.

**Verdict: PARTIALLY VALID** — the project solves a real gap, but only if persistent memory and cross-agent communication are genuinely needed. For pure codebase Q&A, simpler alternatives exist.

**Recommendation:** Lead with the differentiators (persistent memory, cross-repo agents, agent-as-a-service). Do not position it as "better code Q&A" — it will lose that fight against purpose-built tools. Position it as "institutional memory for your codebase that other AI systems can consult."

---

## 7. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **SDK instability** — Letta's TypeScript SDK is actively evolving; method signatures change between versions, breaking the framework | High | High | Pin exact SDK version in `package.json`. Write an integration test suite that exercises every SDK method used. Run tests on every SDK update before upgrading. |
| 2 | **Archival memory retrieval quality** — Dumping raw source files into vector search may produce poor retrieval results (irrelevant matches, missed relevant files) due to naive chunking | High | High | Adopt Aider's repo-map technique: use tree-sitter to extract symbol definitions and call relationships, embed those summaries instead of (or alongside) raw files. This dramatically improves retrieval relevance. |
| 3 | **Ingestion speed at scale** — Loading a large repo (5K+ files) takes 10-30 minutes via sequential API calls, making setup and full re-sync painfully slow | Medium | High | Batch insertions with concurrency (test how many parallel `passages.create` calls Letta tolerates). Consider loading only files matching a relevance heuristic (recently changed, imported frequently) rather than all files. |
| 4 | **Letta Cloud cost/availability** — No published pricing means costs could be unsustainable at scale, and the service could have downtime or rate limiting that blocks usage | Medium | High | Design the framework to be Letta-agnostic at the interface level — use an adapter pattern so the agent backend could be swapped for a local RAG approach if Letta Cloud becomes untenable. |
| 5 | **Cross-agent latency compounding** — A query that triggers cross-repo communication could take 30+ seconds (each hop = LLM inference time), making the CLI feel unresponsive | Medium | Medium | Default to querying a single agent. Only invoke cross-agent communication when the user explicitly asks (e.g., `--all` flag). Use `send_message_to_agent_async` + polling instead of synchronous blocking where possible. |

---

## Summary

The project is **feasible but needs corrections before coding begins**. The core concept — persistent AI agents per repo with cross-agent communication via Letta — is sound and the SDK capabilities mostly exist. However:

**Critical path items:**
1. The spec's SDK code examples are wrong (class names, parameter casing, method paths). Write a spike script first.
2. Archival memory ingestion speed and retrieval quality are the biggest unknowns. Test with a real repo at scale before building the framework around it.
3. The SDK is a moving target. Pin versions and build integration tests early.

**What should change before writing code:**
- Fix all SDK references to match actual `LettaClient` API (camelCase, `passages` not `archival_memory`, `token` not `apiKey`)
- Replace the "store peer agent IDs in memory blocks" design with tag-based discovery (`send_message_to_agents_matching_all_tags`)
- Use the Groups API for orchestration patterns instead of building custom routing
- Add a passage-to-file-path mapping in the state file for incremental sync
- Reduce core memory blocks from 5 to 3-4 with higher character limits
- Plan for the ingestion speed problem: concurrency, relevance filtering, or tree-sitter summarization

The honest question to answer first: **is the target user someone who needs persistent, evolving agent memory and cross-repo reasoning?** If yes, proceed — Letta is the right tool and this framework fills a real gap. If the target user just wants better codebase Q&A, a simpler RAG approach or Greptile integration would deliver value faster with less risk.
