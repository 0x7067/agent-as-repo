import type { AgentProvider } from "./provider.js";
import { BLOCK_LABELS, type AgentState } from "../core/types.js";
import { formatAgentStatus, type AgentStatusData, type BlockStatus } from "../core/status.js";

export async function getAgentStatusData(
  provider: AgentProvider,
  repoName: string,
  agent: AgentState,
): Promise<AgentStatusData> {
  const [passages, ...blocks] = await Promise.all([
    provider.listPassages(agent.agentId),
    ...BLOCK_LABELS.map((label) => provider.getBlock(agent.agentId, label)),
  ]);

  const blockStatuses: BlockStatus[] = blocks.map((b, i) => ({
    label: BLOCK_LABELS[i],
    chars: b.value.length,
    limit: b.limit,
  }));

  return {
    repoName,
    agentId: agent.agentId,
    passageCount: passages.length,
    blocks: blockStatuses,
    lastBootstrap: agent.lastBootstrap,
    lastSyncCommit: agent.lastSyncCommit,
    lastSyncAt: agent.lastSyncAt,
  };
}

export async function getAgentStatus(
  provider: AgentProvider,
  repoName: string,
  agent: AgentState,
): Promise<string> {
  const data = await getAgentStatusData(provider, repoName, agent);
  return formatAgentStatus(data);
}
