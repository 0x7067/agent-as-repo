import type { AgentProvider } from "../ports/agent-provider.js";
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
  /** True when the state file has this agent but the store's agent registry does not (state/store drift). */
  agentMissingFromStore: boolean;
  inSync: boolean;
}

/**
 * Fetch actual server passages and compare against the local passage map.
 * Also checks the store's agent registry directly (via the optional
 * `agentExists`) so drift is caught even when passage counts happen to
 * match — the exact case that let a wiped-then-reindexed store's missing
 * `agents` row go undetected before. Providers without `agentExists` are
 * assumed to have the agent (no change from prior behavior).
 */
export async function reconcileAgent(
  provider: AgentProvider,
  agent: AgentState,
): Promise<ReconcileResult> {
  const [serverPassages, existsInStore] = await Promise.all([
    provider.listPassages(agent.agentId),
    provider.agentExists ? provider.agentExists(agent.agentId) : Promise.resolve(true),
  ]);
  const plan = computeReconcilePlan(agent.passages, serverPassages, !existsInStore);
  return {
    repoName: agent.repoName,
    localPassageCount: Object.values(agent.passages).flat().length,
    serverPassageCount: serverPassages.length,
    orphanPassageIds: plan.orphanPassageIds,
    missingPassageIds: plan.missingPassageIds,
    agentMissingFromStore: plan.agentMissingFromStore,
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
