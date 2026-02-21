import type { AgentProvider } from "./provider.js";
import type { AgentState, PassageMap } from "../core/types.js";
import { cleanMissingFromMap, computeReconcilePlan } from "../core/reconcile.js";

export interface ReconcileResult {
  repoName: string;
  localPassageCount: number;
  serverPassageCount: number;
  /** Passage IDs that exist on the server but are absent from the local map. */
  orphanPassageIds: string[];
  /** Passage IDs recorded locally that no longer exist on the server. */
  missingPassageIds: string[];
  inSync: boolean;
}

/** Fetch actual server passages and compare against the local passage map. */
export async function reconcileAgent(
  provider: AgentProvider,
  agent: AgentState,
): Promise<ReconcileResult> {
  const serverPassages = await provider.listPassages(agent.agentId);
  const plan = computeReconcilePlan(agent.passages, serverPassages);
  return {
    repoName: agent.repoName,
    localPassageCount: Object.values(agent.passages).flat().length,
    serverPassageCount: serverPassages.length,
    orphanPassageIds: plan.orphanPassageIds,
    missingPassageIds: plan.missingPassageIds,
    inSync: plan.inSync,
  };
}

/**
 * Fix detected drift:
 * - Delete orphan passages from the Letta server.
 * - Return an updated passage map with stale missing IDs removed.
 *
 * Orphan deletions that fail (e.g. already gone) are silently ignored.
 */
export async function fixReconcileDrift(
  provider: AgentProvider,
  agent: AgentState,
  result: Pick<ReconcileResult, "orphanPassageIds" | "missingPassageIds">,
): Promise<PassageMap> {
  await Promise.all(
    result.orphanPassageIds.map((id) => provider.deletePassage(agent.agentId, id).catch(() => {})),
  );
  return cleanMissingFromMap(agent.passages, result.missingPassageIds);
}
