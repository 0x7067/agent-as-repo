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

function getOldPassageIds(passages: PassageMap, filePath: string): string[] {
  return Object.hasOwn(passages, filePath)
    ? passages[filePath]
    : [];
}

function removeFilePassages(passages: PassageMap, filePath: string): PassageMap {
  // Avoid dynamic delete while keeping an immutable map update.
  return Object.fromEntries(
    Object.entries(passages).filter(([entryPath]) => entryPath !== filePath),
  );
}

function getIndexableFileInfo(
  fileInfo: FileInfo | null,
  maxFileSizeKb: number | undefined,
): FileInfo | undefined {
  if (fileInfo === null) {
    return undefined;
  }
  if (maxFileSizeKb !== undefined && fileInfo.sizeKb > maxFileSizeKb) {
    return undefined;
  }
  return fileInfo;
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
  let updatedPassages: PassageMap = { ...agent.passages };
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
      const indexableFileInfo = getIndexableFileInfo(fileInfo, maxFileSizeKb);
      if (indexableFileInfo === undefined) {
        stalePassageIds.push(...getOldPassageIds(agent.passages, filePath));
        updatedPassages = removeFilePassages(updatedPassages, filePath);
        filesRemoved++;
      } else {
        const chunks = chunkingStrategy(indexableFileInfo);
        const passageIds: string[] = Array.from({ length: chunks.length });

        await Promise.all(
          chunks.map((chunk, i) =>
            limit(async () => {
              const id = await provider.storePassage(agent.agentId, chunk.text);
              passageIds[i] = id;
            }),
          ),
        );

        // Upload succeeded — queue old passages for deletion, update map
        stalePassageIds.push(...getOldPassageIds(agent.passages, filePath));
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
      limit(async () => {
        try {
          await provider.deletePassage(agent.agentId, passageId);
        } catch {
          // best effort cleanup; indexing result is still valid
        }
      }),
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
