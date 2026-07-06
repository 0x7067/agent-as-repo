import type { AgentState } from "./types.js";

/** How to select the commit range for consolidation git evidence. */
export type EvidenceSource =
  | { kind: "range"; from: string }
  | { kind: "since"; date: string }
  | { kind: "recent"; count: number };

/** Default commit count for the last-resort "recent" fallback. */
const RECENT_COMMIT_COUNT = 20;

/**
 * Decide which git evidence source to use for an agent, following the
 * fallback chain: a still-valid checkpoint commit, then a last-sync
 * timestamp, then a fixed window of recent commits.
 */
export function selectEvidenceSource(agent: AgentState, commitExists: boolean): EvidenceSource {
  if (agent.lastSyncCommit && commitExists) {
    return { kind: "range", from: agent.lastSyncCommit };
  }
  if (agent.lastSyncAt) {
    return { kind: "since", date: agent.lastSyncAt };
  }
  return { kind: "recent", count: RECENT_COMMIT_COUNT };
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

/**
 * Parse the raw output of `git log --name-only --pretty=format:` (blank-line
 * separated paths, no commit metadata) into a deduplicated, order-preserving
 * list of file paths. Used as a superset approximation of the true diff when
 * a sync's checkpoint commit is no longer reachable (see `selectEvidenceSource`'s
 * "since" branch) — re-indexing an unchanged file is idempotent, so the
 * superset is safe to feed through the normal sync path.
 */
export function parseNameOnlyLog(rawLog: string): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const rawLine of rawLog.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || seen.has(line)) continue;
    seen.add(line);
    files.push(line);
  }
  return files;
}
