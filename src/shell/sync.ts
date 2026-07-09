import pLimit from "p-limit";
import { hashFileContent, shouldReindexFile } from "../core/content-hash.js";
import type {
  AgentState,
  ChunkingStrategy,
  Chunk,
  FileHashMap,
  FileInfo,
  PassageMap,
  SymbolFileMap,
  SymbolRankMap,
} from "../core/types.js";
import { computeSyncPlan } from "../core/sync.js";
import { selectChunkingStrategy } from "../core/chunker.js";
import { extractSymbolsAndRefsFromFile } from "../core/tree-sitter-chunker.js";
import { computeSymbolRanks, toStoredSymbolFile } from "../core/symbol-store.js";
import type { PathAliasConfig } from "../core/tsconfig-paths.js";
import type { AgentProvider } from "../ports/agent-provider.js";

export interface SyncRepoParams {
  provider: AgentProvider;
  agent: AgentState;
  changedFiles: string[];
  collectFile: (filePath: string) => Promise<FileInfo | null>;
  headCommit: string;
  maxFileSizeKb?: number;
  chunking?: "raw" | "tree-sitter";
  chunkingStrategy?: ChunkingStrategy;
  concurrency?: number;
  fullReIndexThreshold?: number;
  /** Optional tsconfig path aliases for symbol-graph import resolution. */
  pathAliases?: PathAliasConfig;
  onFileError?: (filePath: string, error: Error) => void;
  onProgress?: (completed: number, total: number, filePath: string) => void;
}

export interface SyncResult {
  passages: PassageMap;
  fileHashes: FileHashMap;
  symbolFiles: SymbolFileMap;
  symbolRanks: SymbolRankMap;
  lastSyncCommit: string;
  filesRemoved: number;
  filesReIndexed: number;
  filesSkippedUnchanged: number;
  isFullReIndex: boolean;
  failedFiles: string[];
}

function getOldPassageIds(passages: PassageMap, filePath: string): string[] {
  return passages[filePath] ?? [];
}

function removeFilePassages(passages: PassageMap, filePath: string): PassageMap {
  return Object.fromEntries(
    Object.entries(passages).filter(([entryPath]) => entryPath !== filePath),
  );
}

function removeFileHash(hashes: FileHashMap, filePath: string): FileHashMap {
  return Object.fromEntries(
    Object.entries(hashes).filter(([entryPath]) => entryPath !== filePath),
  );
}

function removeSymbolFile(files: SymbolFileMap, filePath: string): SymbolFileMap {
  return Object.fromEntries(
    Object.entries(files).filter(([entryPath]) => entryPath !== filePath),
  );
}

/**
 * Stores one file's chunks, preferring provider.storePassages (all of a
 * file's chunks in one batched embedding round trip — the store further
 * splits internally at its own batch size) and falling back to the
 * pLimit-bounded per-chunk storePassage loop when the provider doesn't
 * implement the batch method.
 */
async function storeFileChunks(
  provider: AgentProvider,
  agentId: string,
  chunks: Chunk[],
  limit: ReturnType<typeof pLimit>,
): Promise<string[]> {
  if (provider.storePassages) {
    return provider.storePassages(agentId, chunks.map((chunk) => chunk.text));
  }

  const passageIds: string[] = Array.from({ length: chunks.length });
  await Promise.all(
    chunks.map((chunk, i) =>
      limit(async () => {
        const id = await provider.storePassage(agentId, chunk.text);
        passageIds[i] = id;
      }),
    ),
  );
  return passageIds;
}

function getIndexableFileInfo(
  fileInfo: FileInfo | null,
  maxFileSizeKb: number | undefined,
): FileInfo | undefined {
  if (fileInfo === null) return undefined;
  if (maxFileSizeKb !== undefined && fileInfo.sizeKb > maxFileSizeKb) return undefined;
  return fileInfo;
}

function extractAndStoreSymbols(
  fileInfo: FileInfo,
  updatedSymbols: SymbolFileMap,
): SymbolFileMap {
  const { spans, refs } = extractSymbolsAndRefsFromFile(fileInfo);
  return {
    ...updatedSymbols,
    [fileInfo.path]: toStoredSymbolFile(fileInfo.path, fileInfo.content, spans, refs),
  };
}

interface MutableSyncMaps {
  passages: PassageMap;
  hashes: FileHashMap;
  symbols: SymbolFileMap;
  symbolsDirty: boolean;
}

async function reindexChangedFile(params: {
  provider: AgentProvider;
  agentId: string;
  filePath: string;
  fileInfo: FileInfo;
  nextHash: string;
  agentPassages: PassageMap;
  maps: MutableSyncMaps;
  stalePassageIds: string[];
  limit: ReturnType<typeof pLimit>;
  chunkingStrategy: ChunkingStrategy;
}): Promise<void> {
  // Extract symbols once (same tree-sitter parse the chunker would redo).
  params.maps.symbols = extractAndStoreSymbols(params.fileInfo, params.maps.symbols);
  params.maps.symbolsDirty = true;

  const chunks = params.chunkingStrategy(params.fileInfo);
  const passageIds = await storeFileChunks(params.provider, params.agentId, chunks, params.limit);
  params.stalePassageIds.push(...getOldPassageIds(params.agentPassages, params.filePath));
  params.maps.passages[params.filePath] = passageIds;
  params.maps.hashes[params.filePath] = params.nextHash;
}

function dropChangedFile(
  filePath: string,
  agentPassages: PassageMap,
  maps: MutableSyncMaps,
  stalePassageIds: string[],
): void {
  stalePassageIds.push(...getOldPassageIds(agentPassages, filePath));
  maps.passages = removeFilePassages(maps.passages, filePath);
  maps.hashes = removeFileHash(maps.hashes, filePath);
  if (Object.hasOwn(maps.symbols, filePath)) {
    maps.symbols = removeSymbolFile(maps.symbols, filePath);
    maps.symbolsDirty = true;
  }
}

export async function syncRepo(params: SyncRepoParams): Promise<SyncResult> {
  const {
    provider,
    agent,
    changedFiles,
    collectFile,
    headCommit,
    maxFileSizeKb,
    chunking,
    chunkingStrategy,
    concurrency = 20,
    fullReIndexThreshold = 500,
    pathAliases,
    onFileError,
    onProgress,
  } = params;

  const effectiveChunkingStrategy = chunkingStrategy ?? selectChunkingStrategy(chunking ?? "tree-sitter");
  const plan = computeSyncPlan(agent.passages, changedFiles, fullReIndexThreshold);
  const limit = pLimit(concurrency);
  const maps: MutableSyncMaps = {
    passages: { ...agent.passages },
    hashes: { ...agent.fileHashes },
    symbols: { ...agent.symbolFiles },
    symbolsDirty: false,
  };
  const stalePassageIds: string[] = [];
  const failedFiles: string[] = [];
  let filesReIndexed = 0;
  let filesRemoved = 0;
  let filesSkippedUnchanged = 0;
  let filesCompleted = 0;
  const totalFiles = plan.filesToReIndex.length;

  for (const filePath of plan.filesToReIndex) {
    try {
      const fileInfo = await collectFile(filePath);
      const indexableFileInfo = getIndexableFileInfo(fileInfo, maxFileSizeKb);
      if (indexableFileInfo === undefined) {
        dropChangedFile(filePath, agent.passages, maps, stalePassageIds);
        filesRemoved++;
      } else {
        const nextHash = hashFileContent(indexableFileInfo.content);
        if (shouldReindexFile(maps.hashes[filePath], nextHash)) {
          await reindexChangedFile({
            provider,
            agentId: agent.agentId,
            filePath,
            fileInfo: indexableFileInfo,
            nextHash,
            agentPassages: agent.passages,
            maps,
            stalePassageIds,
            limit,
            chunkingStrategy: effectiveChunkingStrategy,
          });
          filesReIndexed++;
        } else {
          filesSkippedUnchanged++;
        }
      }
    } catch (error_) {
      const error = error_ instanceof Error ? error_ : new Error(String(error_));
      onFileError?.(filePath, error);
      failedFiles.push(filePath);
    } finally {
      onProgress?.(++filesCompleted, totalFiles, filePath);
    }
  }

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

  const symbolRanks = maps.symbolsDirty
    ? computeSymbolRanks(maps.symbols, pathAliases)
    : { ...agent.symbolRanks };

  return {
    passages: maps.passages,
    fileHashes: maps.hashes,
    symbolFiles: maps.symbols,
    symbolRanks,
    lastSyncCommit: headCommit,
    filesRemoved,
    filesReIndexed,
    filesSkippedUnchanged,
    isFullReIndex: plan.isFullReIndex,
    failedFiles,
  };
}
