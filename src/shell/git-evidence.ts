import { selectEvidenceSource, formatGitEvidence } from "../core/git-evidence.js";
import type { AgentState } from "../core/types.js";
import type { GitPort } from "../ports/git.js";

/** Max characters of git evidence embedded in a consolidation prompt (keeps the prompt bounded, per `MAX_LISTED_FILES`). */
export const GIT_EVIDENCE_MAX_CHARS = 4000;

/**
 * Gather formatted git evidence for a consolidation prompt from an agent's
 * currently stored checkpoint (see `selectEvidenceSource`). Shared by every
 * caller that consolidates against "whatever the agent's state says changed"
 * — manual `consolidate` and the watch daemon's post-sync consolidation —
 * as opposed to `sync`, which already knows the exact diff window it just
 * used and formats evidence from that directly.
 *
 * Throws `OrphanedCheckpointError` when the agent's stored checkpoint no
 * longer exists — callers must surface that instead of consolidating
 * against a silently different evidence window.
 */
export function gatherGitEvidence(
  git: GitPort,
  repoPath: string,
  agent: AgentState,
  maxChars: number = GIT_EVIDENCE_MAX_CHARS,
): string {
  const commitExists = agent.lastSyncCommit !== null && git.commitExists(repoPath, agent.lastSyncCommit);
  const source = selectEvidenceSource(agent, commitExists);
  const rawLog = git.logNameStatus(repoPath, source);
  return formatGitEvidence(rawLog, maxChars);
}
