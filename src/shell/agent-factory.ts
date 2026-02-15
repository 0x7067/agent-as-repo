import pLimit from "p-limit";
import type Letta from "@letta-ai/letta-client";
import { buildPersona } from "../core/prompts.js";
import type { RepoConfig, Config, Chunk, PassageMap, AgentState } from "../core/types.js";

export async function createRepoAgent(
  client: Letta,
  repoName: string,
  repoConfig: RepoConfig,
  letta: Config["letta"],
): Promise<AgentState> {
  const persona = buildPersona(repoName, repoConfig.description, repoConfig.persona);

  const agent = await client.agents.create({
    name: `repo-expert-${repoName}`,
    model: letta.model,
    embedding: letta.embedding,
    tools: ["archival_memory_search"],
    tags: ["repo-expert", ...repoConfig.tags],
    memory_blocks: [
      { label: "persona", value: persona, limit: repoConfig.memoryBlockLimit },
      { label: "architecture", value: "Not yet analyzed.", limit: repoConfig.memoryBlockLimit },
      { label: "conventions", value: "Not yet analyzed.", limit: repoConfig.memoryBlockLimit },
    ],
  });

  return {
    agentId: agent.id,
    repoName,
    passages: {},
    lastBootstrap: null,
    createdAt: new Date().toISOString(),
  };
}

export async function loadPassages(
  client: Letta,
  agentId: string,
  chunks: Chunk[],
  concurrency = 20,
): Promise<PassageMap> {
  const limit = pLimit(concurrency);
  const passageMap: PassageMap = {};

  await Promise.all(
    chunks.map((chunk) =>
      limit(async () => {
        const result = await client.agents.passages.create(agentId, { text: chunk.text });
        const passageId = (result as any)[0].id;
        if (!passageMap[chunk.sourcePath]) {
          passageMap[chunk.sourcePath] = [];
        }
        passageMap[chunk.sourcePath].push(passageId);
      }),
    ),
  );

  return passageMap;
}
