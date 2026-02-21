import type { PassageMap } from "./types.js";

export interface ReconcilePlan {
  /** Passage IDs that exist on the Letta server but are absent from the local passage map. */
  orphanPassageIds: string[];
  /** Passage IDs recorded in the local map but no longer present on the Letta server. */
  missingPassageIds: string[];
  inSync: boolean;
}

/**
 * Compare the local passage map against the server's actual passage list.
 * Pure function — no I/O.
 */
export function computeReconcilePlan(
  passageMap: PassageMap,
  serverPassages: Array<{ id: string }>,
): ReconcilePlan {
  const localIds = new Set(Object.values(passageMap).flat());
  const serverIds = new Set(serverPassages.map((p) => p.id));

  const orphanPassageIds = [...serverIds].filter((id) => !localIds.has(id));
  const missingPassageIds = [...localIds].filter((id) => !serverIds.has(id));

  return {
    orphanPassageIds,
    missingPassageIds,
    inSync: orphanPassageIds.length === 0 && missingPassageIds.length === 0,
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
