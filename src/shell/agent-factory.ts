import pLimit from "p-limit";
import type { RepoConfig, Config, Chunk, PassageMap, AgentState } from "../core/types.js";
import type { AgentProvider } from "./provider.js";

export async function createRepoAgent(
  provider: AgentProvider,
  repoName: string,
  repoConfig: RepoConfig,
  letta: Config["letta"],
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

export async function loadPassages(
  provider: AgentProvider,
  agentId: string,
  chunks: Chunk[],
  concurrency = 20,
  onProgress?: (loaded: number, total: number) => void,
): Promise<PassageMap> {
  const limit = pLimit(concurrency);
  const passageMap: PassageMap = {};
  let loaded = 0;

  const results: { sourcePath: string; passageId: string }[] = new Array(chunks.length);

  await Promise.all(
    chunks.map((chunk, i) =>
      limit(async () => {
        const passageId = await provider.storePassage(agentId, chunk.text);
        results[i] = { sourcePath: chunk.sourcePath, passageId };
        loaded++;
        onProgress?.(loaded, chunks.length);
      }),
    ),
  );

  for (const { sourcePath, passageId } of results) {
    if (!passageMap[sourcePath]) {
      passageMap[sourcePath] = [];
    }
    passageMap[sourcePath].push(passageId);
  }

  return passageMap;
}
