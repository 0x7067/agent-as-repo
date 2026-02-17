import pLimit from "p-limit";
import type { AgentState, ChunkingStrategy, FileInfo, PassageMap } from "../core/types.js";
import { computeSyncPlan } from "../core/sync.js";
import { rawTextStrategy } from "../core/chunker.js";
import type { AgentProvider } from "./provider.js";

export interface SyncRepoParams {
  provider: AgentProvider;
  agent: AgentState;
  changedFiles: string[];
  collectFile: (filePath: string) => Promise<FileInfo | null>;
  headCommit: string;
  chunkingStrategy?: ChunkingStrategy;
  concurrency?: number;
  fullReIndexThreshold?: number;
}

export interface SyncResult {
  passages: PassageMap;
  lastSyncCommit: string;
  filesDeleted: number;
  filesReIndexed: number;
  isFullReIndex: boolean;
}

export async function syncRepo(params: SyncRepoParams): Promise<SyncResult> {
  const {
    provider,
    agent,
    changedFiles,
    collectFile,
    headCommit,
    chunkingStrategy = rawTextStrategy,
    concurrency = 20,
    fullReIndexThreshold = 500,
  } = params;

  const plan = computeSyncPlan(agent.passages, changedFiles, fullReIndexThreshold);

  // Delete old passages for changed files
  const limit = pLimit(concurrency);
  await Promise.all(
    plan.passagesToDelete.map((passageId) =>
      limit(() => provider.deletePassage(agent.agentId, passageId)),
    ),
  );

  // Remove deleted passages from map
  const updatedPassages: PassageMap = { ...agent.passages };
  for (const file of changedFiles) {
    delete updatedPassages[file];
  }

  // Re-index: collect files, chunk, store
  let filesReIndexed = 0;
  for (const filePath of plan.filesToReIndex) {
    const fileInfo = await collectFile(filePath);
    if (!fileInfo) continue;

    const chunks = chunkingStrategy(fileInfo);
    const passageIds: string[] = new Array(chunks.length);

    await Promise.all(
      chunks.map((chunk, i) =>
        limit(async () => {
          const id = await provider.storePassage(agent.agentId, chunk.text);
          passageIds[i] = id;
        }),
      ),
    );

    updatedPassages[filePath] = passageIds;
    filesReIndexed++;
  }

  return {
    passages: updatedPassages,
    lastSyncCommit: headCommit,
    filesDeleted: changedFiles.length - filesReIndexed,
    filesReIndexed,
    isFullReIndex: plan.isFullReIndex,
  };
}
