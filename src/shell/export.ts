import type { AgentProvider } from "./provider.js";
import { formatExport } from "../core/export.js";
import { BLOCK_LABELS, FILE_PREFIX } from "../core/types.js";

export async function exportAgent(
  provider: AgentProvider,
  repoName: string,
  agentId: string,
): Promise<string> {
  const [passages, ...blocks] = await Promise.all([
    provider.listPassages(agentId),
    ...BLOCK_LABELS.map((label) => provider.getBlock(agentId, label)),
  ]);

  const files = new Set<string>();
  for (const p of passages) {
    const firstLine = p.text.split("\n")[0];
    if (firstLine.startsWith(FILE_PREFIX)) {
      files.add(firstLine.slice(FILE_PREFIX.length).replace(/ \(continued\)$/, ""));
    }
  }

  return formatExport({
    repoName,
    agentId,
    blocks: blocks.map((b, i) => ({ label: BLOCK_LABELS[i], value: b.value })),
    files: [...files].sort(),
  });
}
