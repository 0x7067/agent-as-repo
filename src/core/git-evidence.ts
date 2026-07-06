import type { AgentState } from "./types.js";

/** How to select the commit range for consolidation git evidence. */
export type EvidenceSource =
  | { kind: "range"; from: string }
  | { kind: "since"; date: string }
  | { kind: "recent"; count: number };

/** Commit count used when an agent has never synced or watched. */
const RECENT_COMMIT_COUNT = 20;

/**
 * Raised when an agent's stored checkpoint commit no longer exists in the
 * repository (rebase, force-push, or gc). Deliberately not recovered from:
 * callers must fail loudly and ask the user for an explicit new window
 * (`sync --since <ref>` or `sync --full`) instead of guessing one.
 */
export class OrphanedCheckpointError extends Error {
  readonly commit: string;

  constructor(commit: string) {
    super(`checkpoint commit ${commit} no longer exists in the repository`);
    this.name = "OrphanedCheckpointError";
    this.commit = commit;
  }
}

/**
 * Decide which git evidence source to use for an agent. A stored checkpoint
 * is authoritative: if it no longer exists, this throws
 * `OrphanedCheckpointError` rather than silently choosing a different window.
 * The "since" and "recent" kinds are initial-state selection only — they
 * apply to agents that have never recorded a checkpoint (watch-only agents
 * have a `lastSyncAt` timestamp; brand-new agents have nothing).
 */
export function selectEvidenceSource(agent: AgentState, commitExists: boolean): EvidenceSource {
  if (agent.lastSyncCommit) {
    if (!commitExists) {
      throw new OrphanedCheckpointError(agent.lastSyncCommit);
    }
    return { kind: "range", from: agent.lastSyncCommit };
  }
  if (agent.lastSyncAt) {
    return { kind: "since", date: agent.lastSyncAt };
  }
  return { kind: "recent", count: RECENT_COMMIT_COUNT };
}

/**
 * Format the recovery message for an orphaned checkpoint: names the
 * short SHA and points at the two explicit recovery paths (`sync --since
 * <ref>` / `sync --full`). Shared by every caller that surfaces
 * `OrphanedCheckpointError` to a human — sync, manual consolidate, and the
 * watch daemon — so the instructions never drift between them.
 */
export function formatOrphanedCheckpointMessage(commit: string): string {
  return `checkpoint commit ${commit.slice(0, 7)} no longer exists (rebase, force-push, or gc?). ` +
    `Refusing to guess a diff window — re-run with "repo-expert sync --since <ref>" or "repo-expert sync --full".`;
}

/**
 * Format a raw `git log --name-status --oneline` output as a fenced section
 * for the consolidation prompt, truncated from the oldest end so the newest
 * commits (the most relevant evidence) are kept.
 */
export function formatGitEvidence(rawLog: string, maxChars: number): string {
  const trimmed = rawLog.trim();
  if (trimmed.length === 0) return "";

  if (trimmed.length <= maxChars) {
    return ["```", trimmed, "```"].join("\n");
  }

  // `git log` prints newest first, so keep entries from the front and stop at
  // the first commit that no longer fits — truncating the oldest end without
  // leaving gaps in the middle of the history.
  const commits = trimmed.split(/\n(?=[0-9a-f]{7,40} )/);
  const kept: string[] = [];
  let usedChars = 0;

  for (const commit of commits) {
    const addedChars = commit.length + (kept.length > 0 ? 1 : 0);
    if (usedChars + addedChars > maxChars) break;
    kept.push(commit);
    usedChars += addedChars;
  }

  const omitted = commits.length - kept.length;

  const body = kept.join("\n");
  const lines = ["```", body];
  if (omitted > 0) {
    lines.push(`…and ${String(omitted)} earlier commits omitted`);
  }
  lines.push("```");
  return lines.join("\n");
}
