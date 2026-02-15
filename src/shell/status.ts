import type { AgentProvider } from "./provider.js";
import type { AgentState } from "../core/types.js";
import { formatAgentStatus, type BlockStatus } from "../core/status.js";

const BLOCK_LABELS = ["persona", "architecture", "conventions"];

export async function getAgentStatus(
  provider: AgentProvider,
  repoName: string,
  agent: AgentState,
): Promise<string> {
  const [passages, ...blocks] = await Promise.all([
    provider.listPassages(agent.agentId),
    ...BLOCK_LABELS.map((label) => provider.getBlock(agent.agentId, label)),
  ]);

  const blockStatuses: BlockStatus[] = blocks.map((b, i) => ({
    label: BLOCK_LABELS[i],
    chars: b.value.length,
    limit: b.limit,
  }));

  return formatAgentStatus({
    repoName,
    agentId: agent.agentId,
    passageCount: passages.length,
    blocks: blockStatuses,
    lastBootstrap: agent.lastBootstrap,
    lastSyncCommit: agent.lastSyncCommit,
  });
}
