# Research: Letta Features & Reliability Audit (2026-02-18)

## Context Repositories (MemFS)

- **Letta Code-only** (v0.14+), NO public REST API or SDK methods
- Replaces **memory blocks** (in-context), NOT archival memory (out-of-context)
- Git-backed `.md` files with YAML frontmatter
- Multi-agent via git worktrees for concurrent memory writes
- Built-in skills: init, reflection (sleep-time), defragmentation
- `@letta-ai/letta-client` v1.7.8 has zero context repository methods
- **Verdict: cannot use from our CLI/MCP architecture**

## Continual Learning / Sleep-Time

- `enable_sleeptime: true` flag exists in SDK v1.7.8 — available NOW
- Background memory consolidation, pattern abstraction
- `@letta-ai/agentic-learning` is separate (conversation memory, not context repos)
- **Verdict: sleep-time is a quick win we can adopt**

## Archival Memory Status

- Still fully supported, no deprecation notices (checked 2026-02-18)
- `archival_memory_insert` / `archival_memory_search` tools unchanged
- Passage CRUD via SDK unchanged
- **Verdict: stay on passages, our approach is correct**

## Reliability Issues (Codex + Claude code-explorer agreed)

### Sync Pipeline
1. Delete-first sync creates inconsistency window (sync.ts:42-54)
2. No partial-failure recovery — orphan passages on retry (agent-factory.ts:46-56)
3. Retry only on 429, misses 5xx/network errors (letta-provider.ts:21-39)
4. `storePassage` returns `result[0].id ?? ""` — empty string is silently wrong
5. `reindex_full` doesn't delete old passages before uploading new ones
6. Concurrent `saveState` calls from parallel repo syncs can race (watch.ts)

### Watch Daemon
7. No backoff on repeated sync failures (retries every 5s forever)
8. `activeTick` overwritten each interval (safe but confusing)
9. `fs.watch` recursive mode silently fails on Linux
10. Daemon plist missing LETTA_API_KEY in environment

### Setup Flow
11. Agent created but state save fails → orphaned agent in Letta
12. Bootstrap failure tracking is coarse (per-bootstrap, not per-step)
13. State never validated against actual Letta state (no reconciliation)

### Error Handling
14. Broad `catch {}` swallows errors silently in multiple places
15. `sync` command has no retry wrapper (unlike `setup`)
16. `destroy` swallows all deleteAgent errors — agent may leak

## Recommended Priority

1. **Sync reliability** — transactional journal, copy-on-write, expanded retry
2. **Setup robustness** — save state earlier, reconciliation command
3. **Sleep-time adoption** — quick win, one flag
4. **Watch hardening** — backoff, state mutex, cross-platform warnings
