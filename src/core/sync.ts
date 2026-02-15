import type { PassageMap } from "./types.js";

export interface SyncPlan {
  passagesToDelete: string[];
  filesToReIndex: string[];
  isFullReIndex: boolean;
}

export function computeSyncPlan(
  passages: PassageMap,
  changedFiles: string[],
  fullReIndexThreshold = 500,
): SyncPlan {
  const isFullReIndex = changedFiles.length > fullReIndexThreshold;

  const passagesToDelete: string[] = [];
  for (const file of changedFiles) {
    const ids = passages[file];
    if (ids) {
      passagesToDelete.push(...ids);
    }
  }

  return {
    passagesToDelete,
    filesToReIndex: changedFiles,
    isFullReIndex,
  };
}
