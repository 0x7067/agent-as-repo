# Auto-Updating Context Loop Spec — Extracting openwiki's Mechanisms

Date: 2026-07-06
Status: proposed
Reference: [langchain-ai/openwiki](https://github.com/langchain-ai/openwiki) (source read 2026-07-06; mechanisms confirmed from `src/agent/utils.ts`, `src/agent/index.ts`, `src/agent/prompt.ts`, shipped GH Action)
Depends on: sync pipeline (`src/core/sync.ts`, `src/shell/sync.ts`), consolidation (`src/core/consolidate.ts`), state store (`src/shell/state-store.ts`)

## Why

openwiki keeps AI-written docs fresh forever with a loop of four mechanisms: git evidence in, fingerprint verification out, a commit checkpoint between runs, and an injection point coding agents already read (CLAUDE.md/AGENTS.md). The lesson transfers directly: our "docs" are the agent's memory blocks and passage store, and the same loop keeps them honest.

We already have more of this loop than openwiki does — but with specific gaps:

| openwiki mechanism | We have | Gap |
|---|---|---|
| 1. Git delta evidence fed to the agent (`git log <last>..HEAD --name-status --oneline` in the prompt) | `sync` diffs file *names* since `lastSyncCommit` to pick passages to re-index | Consolidation prompt gets bare file paths — no commit messages, no change kinds (A/M/D). The LLM refreshes architecture/conventions blocks by guessing what changed. |
| 2. Fingerprint before/after; identical hash → no write, no commit | Nothing | Consolidation always burns a `memory_replace` turn and we can't tell a no-op refresh from a real one; state timestamps advance either way. |
| 3. Checkpoint = last-run commit SHA; graceful fallback chain when it's missing | `lastSyncCommit` + `lastSyncAt` in `.repo-expert-state.json`, `watch`/daemon loop | No fallback: if `lastSyncCommit` vanished (rebase, force-push, shallow CI clone), `git diff <sha>..HEAD` fails hard instead of degrading to `--since` or full re-index. |
| 4. Append a section to CLAUDE.md/AGENTS.md pointing agents at the fresh context | `mcp-install` registers the MCP server, but nothing tells the coding agent to *use* it | No injection. A Claude Code session in a consumer repo has the tools available but no instruction to reach for them first. |

Explicitly **not** copying: openwiki's LLM-judgment dedup for the injected block (it tells the model "recognize your own section and don't duplicate it"). We do it deterministically with markers — testable pure function, zero model risk.

## Design

### 1. Git evidence in consolidation

**Core (pure) — extend `src/core/consolidate.ts` + new `src/core/git-evidence.ts`:**

- `selectEvidenceSource(agent: AgentState, commitExists: boolean): EvidenceSource` — openwiki's fallback chain as a pure decision:
  - `lastSyncCommit` set and still known to git → `{ kind: "range", from: lastSyncCommit }`
  - else `lastSyncAt` set → `{ kind: "since", date: lastSyncAt }`
  - else → `{ kind: "recent", count: 20 }`
- `formatGitEvidence(rawLog: string, maxChars: number): string` — wraps output as a fenced section, truncates from the *oldest* end (newest commits are the evidence that matters), appends `…and N earlier commits omitted` when cut. Cap: 4 000 chars (consistent with `MAX_LISTED_FILES` keeping the prompt bounded).
- `buildConsolidationPrompt`: new optional `gitEvidence?: string` on `ConsolidationPromptInput`, rendered between the changed-files section and the current blocks with a one-line preamble ("Commit log since the last sync — treat as ground truth for what changed"). Absent → prompt is byte-identical to today (no churn for existing tests).

**Shell — `src/ports/git.ts` + `src/shell/adapters/node-git.ts`:**

- Two `GitPort` additions:
  - `commitExists(cwd, sha): boolean` — `git cat-file -e <sha>^{commit}`
  - `logNameStatus(cwd, source: EvidenceSource): string` — `git --no-pager log <from>..HEAD --name-status --oneline` / `--since=<date>` / `--max-count=20` variants. `execFileSync` arg arrays, `maxBuffer: 1 MiB`; on git error return `""` (evidence is best-effort — a broken log must never fail consolidation, mirroring openwiki's swallow-errors stance).
- Callers: `sync` post-run consolidation (`src/cli.ts` around `shouldConsolidate`) and the manual `consolidate` command both gather evidence via the port before building the prompt. Manual runs finally get real context (today their `changedFiles` is empty).

**Tests:** pure — fallback-chain selection (all three branches), truncation keeps newest commits, empty-log → empty string; prompt renders with/without evidence. Shell — `nodeGit` methods against a temp git repo fixture (pattern already used by adapter tests).

### 2. Fingerprint no-op detection for consolidation

**Core (pure) — `src/core/fingerprint.ts`:**

- `fingerprintBlocks(blocks: Record<string, string>): string` — SHA-256 over labels sorted with `localeCompare`, each contribution `label\0value\0` (openwiki's null-delimited scheme; prevents `("a","bc")` colliding with `("ab","c")`). `node:crypto` is deterministic and I/O-free — core-eligible.

**Shell — `src/shell/consolidate.ts`:**

- Hash `architecture` + `conventions` before `provider.consolidateMemory(...)`, re-read and hash after. Same hash → report `{ changed: false }`, skip the state write, log `consolidation: blocks unchanged`. Different → proceed as today.
- Pre-LLM short-circuit for the manual `consolidate` command: if `HEAD === lastSyncCommit` **and** a previous consolidation already ran at that commit, skip the LLM call entirely with "no repository changes since last consolidation" (openwiki's `getUpdateNoopStatus` equivalent — the scheduled run that finds nothing costs nothing). Requires the state field below.

**State — one additive field, no version bump:**

- `AgentState.lastConsolidatedCommit?: string | null` — zod `.optional().default(null)` in `state-store.ts` schema (v2 files parse unchanged; no migration). Written only when the post-hash differs from the pre-hash — so like openwiki's `.last-update.json`, a no-op run leaves *zero* trace, and repeated no-op runs stay no-ops.

**Tests:** pure — fingerprint stable across key order, sensitive to label/value swaps, null-byte collision case. Shell — mock provider returning unchanged blocks → no state write, no `lastConsolidatedCommit` bump; changed blocks → both.

### 3. Checkpoint fallback for sync

**Problem:** `sync` runs `git diff --name-only <lastSyncCommit>..HEAD` inline in `src/cli.ts:1137`. A checkpoint SHA orphaned by rebase/force-push/shallow-clone makes the command throw and the sync die, when the correct behavior is to degrade.

**Change (shell + one pure helper):**

- Before diffing, validate the checkpoint via `gitPort.commitExists`. Reuse `selectEvidenceSource` from item 1 for the decision (same chain, same tests):
  - `range` → today's diff path, unchanged.
  - `since` → `git log --since=<lastSyncAt> --name-only --pretty=format:` deduped — a superset approximation of the true delta; passing it through the existing `computeSyncPlan` re-index path is safe because re-indexing an unchanged file is idempotent (copy-on-write delete-then-insert in `src/shell/sync.ts`).
  - `recent`/nothing → fall back to `--full` re-collect with a printed warning naming the lost checkpoint.
- While in there: route sync's inline `execFileSync("git", ...)` calls (`gitHeadCommit`, the diff) through `GitPort`/`nodeGit`, which already exists and is used by `doctor` — removes the duplication the port was created to prevent. Behavior-preserving; suite stays green before the fallback lands.

**Tests:** temp-repo shell test — commit, sync, `rebase`/`commit --amend` away the checkpoint SHA, second sync degrades to `since` (not a crash) and re-checkpoints HEAD.

### 4. Agent-instructions injection — `repo-expert install-instructions`

The highest-leverage item: it closes the loop by putting our freshest context where every Claude Code session already looks.

**Core (pure) — `src/core/agent-instructions.ts`:**

- `renderInstructionsBlock(input: { repoNames: string[] }): string` — the block, marker-delimited:

  ```markdown
  <!-- repo-expert:start -->
  ## Repo Expert

  This repository is indexed by a repo-expert agent with continuously synced
  semantic memory (MCP server: `repo-expert`).

  Before broad codebase exploration, prefer these MCP tools:
  - `ask_repo_expert` — ask the expert a question about this codebase
  - `agent_search_archival` — semantic + lexical search over indexed passages

  Indexed repos: <repoNames>
  <!-- repo-expert:end -->
  ```

  (Exact tool names to be taken from `src/mcp-server.ts` at implementation time — do not guess in code.)
- `spliceInstructionsBlock(existing: string | null, block: string): { content: string; changed: boolean }` — idempotent: existing marker pair → replace between markers; no markers → append with a separating blank line; result identical to input → `changed: false`. Malformed (start without end) → replace from start-marker to EOF and warn via a returned `warning?: string` (never duplicate).

**Shell — `src/shell/agent-instructions.ts` + `src/cli.ts`:**

- New command `install-instructions` with `--repo <name>` (default: all configured repos), `--file <path>` override, `--remove` (splice the block out), `--dry-run`.
- Target selection per openwiki, deterministic: top-level `CLAUDE.md` and `AGENTS.md` of the *target repo* — update whichever exist (both if both); neither exists → create `AGENTS.md` containing only the block. Never touch nested instruction files.
- `changed: false` → no write, print "already up to date" (item 2's discipline applied here too).
- `mcp-install` gains a closing hint suggesting the command (no auto-run — writing into a user's CLAUDE.md needs explicit intent).

**Tests:** pure splice — append / replace / no-op / malformed-marker / remove, all round-trip idempotent (`splice(splice(x).content) → changed: false`). Shell — temp dir: no files → creates AGENTS.md; both files → both updated; second run → zero writes (assert mtime or fs-mock call count).

## Out of Scope

- **A GitHub Action.** openwiki's artifact is in-repo markdown, so `create-pull-request` scoped to `openwiki/` *is* its delivery mechanism. Ours is a local sqlite store at `~/.repo-expert/store.db` — nothing to commit. The scheduled-loop analog already exists (`watch` + `install-daemon`). CI-hosted sync would need store artifact caching or a remote store; separate spec if ever needed.
- **Feeding full diffs/hunks to consolidation.** openwiki doesn't either — it embeds `--name-status` only and lets its agent pull hunks through its own tool loop. Our consolidation turn deliberately exposes only `memory_replace` (per CLAUDE.md, the send loop defines the tool surface); commit subjects + name-status is the right evidence weight. Revisit only if consolidation quality demonstrably lags.
- **openwiki-style LLM-managed injection dedup** — rejected above in favor of markers.

## Phasing

Each phase is independently shippable, TDD red-green, ordered by leverage:

1. **Item 4** (install-instructions) — pure splice + command; no provider or git surface. ~1 day.
2. **Item 1** (git evidence) — port methods + prompt change behind an optional field. ~1 day.
3. **Item 2** (fingerprint) — depends on nothing but touches consolidation flow; land after 1 so its "changed" signal reflects evidence-driven runs. ~0.5 day.
4. **Item 3** (checkpoint fallback) — includes the GitPort routing cleanup in sync. ~1 day.

Pre-PR checklist applies per phase: green suite, pure logic in core (fingerprint, splice, evidence selection/formatting are all pure), no mocks in core tests, colocated test files.
