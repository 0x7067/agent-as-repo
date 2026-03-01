import pLimit from "p-limit";
import type { RepoConfig, Chunk, PassageMap, AgentState } from "../core/types.js";
import type { AgentProvider } from "./provider.js";

interface CreateRepoAgentLettaOptions {
  model: string;
  embedding: string;
}

export async function createRepoAgent(
  provider: AgentProvider,
  repoName: string,
  repoConfig: RepoConfig,
  letta: CreateRepoAgentLettaOptions,
): Promise<AgentState> {
  const { agentId } = await provider.createAgent({
    name: `repo-expert-${repoName}`,
    repoName,
    description: repoConfig.description,
    persona: repoConfig.persona,
    tags: ["repo-expert", ...repoConfig.tags],
    tools: repoConfig.tools,
    model: letta.model,
    embedding: letta.embedding,
    memoryBlockLimit: repoConfig.memoryBlockLimit,
  });

  return {
    agentId,
    repoName,
    passages: {},
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

export async function loadPassages(
  provider: AgentProvider,
  agentId: string,
  chunks: Chunk[],
  concurrency = 20,
  onProgress?: (loaded: number, total: number) => void,
): Promise<LoadPassagesResult> {
  const limit = pLimit(concurrency);
  const passageMap: PassageMap = {};
  let loaded = 0;
  let failedChunks = 0;

  const settled = await Promise.allSettled(
    chunks.map((chunk, i) =>
      limit(async () => {
        const passageId = await provider.storePassage(agentId, chunk.text);
        loaded++;
        onProgress?.(loaded, chunks.length);
        return { index: i, sourcePath: chunk.sourcePath, passageId };
      }),
    ),
  );

  for (const result of settled) {
    if (result.status === "rejected") {
      failedChunks++;
      continue;
    }
    const { sourcePath, passageId } = result.value;
    if (!passageMap[sourcePath]) {
      passageMap[sourcePath] = [];
    }
    passageMap[sourcePath].push(passageId);
  }

  return { passages: passageMap, failedChunks };
}
