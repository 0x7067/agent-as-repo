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
  maxFileSizeKb?: number;
  chunkingStrategy?: ChunkingStrategy;
  concurrency?: number;
  fullReIndexThreshold?: number;
  onFileError?: (filePath: string, error: Error) => void;
  onProgress?: (completed: number, total: number, filePath: string) => void;
}

export interface SyncResult {
  passages: PassageMap;
  lastSyncCommit: string;
  filesRemoved: number;
  filesReIndexed: number;
  isFullReIndex: boolean;
  failedFiles: string[];
}

export async function syncRepo(params: SyncRepoParams): Promise<SyncResult> {
  const {
    provider,
    agent,
    changedFiles,
    collectFile,
    headCommit,
    maxFileSizeKb,
    chunkingStrategy = rawTextStrategy,
    concurrency = 20,
    fullReIndexThreshold = 500,
    onFileError,
    onProgress,
  } = params;

  const plan = computeSyncPlan(agent.passages, changedFiles, fullReIndexThreshold);
  const limit = pLimit(concurrency);
  const updatedPassages: PassageMap = { ...agent.passages };
  const stalePassageIds: string[] = [];
  const failedFiles: string[] = [];
  let filesReIndexed = 0;
  let filesRemoved = 0;
  let filesCompleted = 0;
  const totalFiles = plan.filesToReIndex.length;

  // Phase 1: Upload new passages (copy-on-write — old passages stay intact until phase 2)
  for (const filePath of plan.filesToReIndex) {
    try {
      const fileInfo = await collectFile(filePath);
      if (!fileInfo) {
        // File deleted — mark old passages for cleanup, remove from map
        const oldIds = agent.passages[filePath];
        if (oldIds) stalePassageIds.push(...oldIds);
        delete updatedPassages[filePath];
        filesRemoved++;
      } else if (maxFileSizeKb !== undefined && fileInfo.sizeKb > maxFileSizeKb) {
        // Oversized — mark old passages for cleanup, remove from map
        const oldIds = agent.passages[filePath];
        if (oldIds) stalePassageIds.push(...oldIds);
        delete updatedPassages[filePath];
        filesRemoved++;
      } else {
        const chunks = chunkingStrategy(fileInfo);
        const passageIds: string[] = Array.from({length: chunks.length});

        await Promise.all(
          chunks.map((chunk, i) =>
            limit(async () => {
              const id = await provider.storePassage(agent.agentId, chunk.text);
              passageIds[i] = id;
            }),
          ),
        );

        // Upload succeeded — queue old passages for deletion, update map
        const oldIds = agent.passages[filePath];
        if (oldIds) stalePassageIds.push(...oldIds);
        updatedPassages[filePath] = passageIds;
        filesReIndexed++;
      }
    } catch (error_) {
      // Per-file failure: keep old passages intact, report the failure
      const error = error_ instanceof Error ? error_ : new Error(String(error_));
      onFileError?.(filePath, error);
      failedFiles.push(filePath);
    } finally {
      onProgress?.(++filesCompleted, totalFiles, filePath);
    }
  }

  // Phase 2: Delete old (now stale) passages — failures here are non-critical
  await Promise.all(
    stalePassageIds.map((passageId) =>
      limit(() => provider.deletePassage(agent.agentId, passageId).catch(() => {})),
    ),
  );

  return {
    passages: updatedPassages,
    lastSyncCommit: headCommit,
    filesRemoved,
    filesReIndexed,
    isFullReIndex: plan.isFullReIndex,
    failedFiles,
  };
}
