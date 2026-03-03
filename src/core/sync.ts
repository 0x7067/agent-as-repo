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
    const existingPassages = Object.hasOwn(passages, file)
      ? passages[file]
      : undefined;
    if (existingPassages !== undefined) {
      passagesToDelete.push(...existingPassages);
    }
  }

  return {
    passagesToDelete,
    filesToReIndex: changedFiles,
    isFullReIndex,
  };
}
