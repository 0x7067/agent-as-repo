import type { PassageMap } from "./types.js";

export interface ReconcilePlan {
  /** Passage IDs that exist on the Letta server but are absent from the local passage map. */
  orphanPassageIds: string[];
  /** Passage IDs recorded in the local map but no longer present on the Letta server. */
  missingPassageIds: string[];
  /** True when the state file has this agent but the store's agent registry does not. */
  agentMissingFromStore: boolean;
  inSync: boolean;
}

/**
 * Compare the local passage map against the server's actual passage list.
 * Pure function — no I/O. `agentMissingFromStore` (default false) lets the
 * caller fold in a separate store-registry check: even matching passage
 * counts aren't "in sync" if the agent itself was never registered (or was
 * wiped) in the store — that's the state-file/store drift bug, distinct from
 * ordinary passage drift.
 */
export function computeReconcilePlan(
  passageMap: PassageMap,
  serverPassages: Array<{ id: string }>,
  agentMissingFromStore = false,
): ReconcilePlan {
  const localIds = new Set(Object.values(passageMap).flat());
  const serverIds = new Set(serverPassages.map((p) => p.id));

  const orphanPassageIds = [...serverIds].filter((id) => !localIds.has(id));
  const missingPassageIds = [...localIds].filter((id) => !serverIds.has(id));

  return {
    orphanPassageIds,
    missingPassageIds,
    agentMissingFromStore,
    inSync: orphanPassageIds.length === 0 && missingPassageIds.length === 0 && !agentMissingFromStore,
  };
}

/**
 * Given a passage map and a set of missing passage IDs (entries in the local
 * map that no longer exist on the server), return an updated map with those
 * stale IDs removed. Files whose passage list becomes empty are dropped.
 */
export function cleanMissingFromMap(passageMap: PassageMap, missingIds: string[]): PassageMap {
  if (missingIds.length === 0) return passageMap;
  const missingSet = new Set(missingIds);
  const updated: PassageMap = {};
  for (const [filePath, ids] of Object.entries(passageMap)) {
    const cleaned = ids.filter((id) => !missingSet.has(id));
    if (cleaned.length > 0) updated[filePath] = cleaned;
  }
  return updated;
}
