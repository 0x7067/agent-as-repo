import pLimit from "p-limit";
import type { RepoConfig, Chunk, PassageMap, AgentState } from "../core/types.js";
import type { AgentProvider } from "../ports/agent-provider.js";

interface CreateRepoAgentModelOptions {
  model: string;
}

export async function createRepoAgent(
  provider: AgentProvider,
  repoName: string,
  repoConfig: RepoConfig,
  modelOptions: CreateRepoAgentModelOptions,
): Promise<AgentState> {
  const createAgentParams: Parameters<AgentProvider["createAgent"]>[0] = {
    name: `repo-expert-${repoName}`,
    repoName,
    description: repoConfig.description,
    model: modelOptions.model,
    ...(repoConfig.persona === undefined ? {} : { persona: repoConfig.persona }),
    ...(repoConfig.basePath === undefined ? {} : { basePath: repoConfig.basePath }),
  };
  const { agentId } = await provider.createAgent(createAgentParams);

  return {
    agentId,
    repoName,
    passages: {},
    fileHashes: {},
    symbolFiles: {},
    symbolRanks: {},
    lastBootstrap: null,
    lastSyncCommit: null,
    lastSyncAt: null,
    createdAt: new Date().toISOString(),
  };
}

export interface LoadPassagesResult {
  passages: PassageMap;
  failedChunks: number;
}

/** Max chunks per provider.storePassages call in the batched load path. */
const STORE_PASSAGES_BATCH_SIZE = 32;

function addPassageId(passageMap: PassageMap, sourcePath: string, passageId: string): void {
  const filePassages = Object.hasOwn(passageMap, sourcePath) ? passageMap[sourcePath] : undefined;
  if (filePassages === undefined) {
    passageMap[sourcePath] = [passageId];
    return;
  }
  filePassages.push(passageId);
}

export async function loadPassages(
  provider: AgentProvider,
  agentId: string,
  chunks: Chunk[],
  concurrency = 20,
  onProgress?: (loaded: number, total: number) => void,
): Promise<LoadPassagesResult> {
  const storePassages = provider.storePassages?.bind(provider);
  if (storePassages) {
    return loadPassagesInBatches(storePassages, agentId, chunks, concurrency, onProgress);
  }
  return loadPassagesPerChunk(provider, agentId, chunks, concurrency, onProgress);
}

async function loadPassagesPerChunk(
  provider: AgentProvider,
  agentId: string,
  chunks: Chunk[],
  concurrency: number,
  onProgress?: (loaded: number, total: number) => void,
): Promise<LoadPassagesResult> {
  const limit = pLimit(concurrency);
  const passageMap: PassageMap = {};
  let loaded = 0;
  let failedChunks = 0;

  const settled = await Promise.allSettled(
    chunks.map((chunk) =>
      limit(async () => {
        const passageId = await provider.storePassage(agentId, chunk.text);
        loaded++;
        onProgress?.(loaded, chunks.length);
        return { sourcePath: chunk.sourcePath, passageId };
      }),
    ),
  );

  for (const result of settled) {
    if (result.status === "rejected") {
      failedChunks++;
      continue;
    }
    addPassageId(passageMap, result.value.sourcePath, result.value.passageId);
  }

  return { passages: passageMap, failedChunks };
}

/**
 * Batch load path: groups chunks into STORE_PASSAGES_BATCH_SIZE-sized calls
 * to provider.storePassages (fewer embedding round trips than one
 * storePassage per chunk). Progress fires once per completed batch — still
 * enough for the CLI progress display to advance. A batch that rejects
 * counts all its chunks as failed without aborting the other batches.
 */
async function loadPassagesInBatches(
  storePassages: NonNullable<AgentProvider["storePassages"]>,
  agentId: string,
  chunks: Chunk[],
  concurrency: number,
  onProgress?: (loaded: number, total: number) => void,
): Promise<LoadPassagesResult> {
  const limit = pLimit(concurrency);
  const passageMap: PassageMap = {};
  let loaded = 0;
  let failedChunks = 0;

  const batches: Chunk[][] = [];
  for (let i = 0; i < chunks.length; i += STORE_PASSAGES_BATCH_SIZE) {
    batches.push(chunks.slice(i, i + STORE_PASSAGES_BATCH_SIZE));
  }

  const settled = await Promise.allSettled(
    batches.map((batch) =>
      limit(async () => {
        const passageIds = await storePassages(agentId, batch.map((chunk) => chunk.text));
        loaded += batch.length;
        onProgress?.(loaded, chunks.length);
        return batch.map((chunk, i) => {
          const passageId = passageIds.at(i);
          if (passageId === undefined) {
            throw new Error("storePassages returned fewer passage IDs than input texts");
          }
          return { sourcePath: chunk.sourcePath, passageId };
        });
      }),
    ),
  );

  for (const [index, result] of settled.entries()) {
    if (result.status === "rejected") {
      failedChunks += batches.at(index)?.length ?? 0;
      continue;
    }
    for (const { sourcePath, passageId } of result.value) {
      addPassageId(passageMap, sourcePath, passageId);
    }
  }

  return { passages: passageMap, failedChunks };
}
