export interface BlockStatus {
  label: string;
  chars: number;
  limit: number;
}

export interface AgentStatusData {
  repoName: string;
  agentId: string;
  passageCount: number;
  blocks: BlockStatus[];
  lastBootstrap: string | null;
  lastSyncCommit: string | null;
  lastSyncAt: string | null;
}

export function formatAgentStatus(data: AgentStatusData): string {
  const lines: string[] = [
    `${data.repoName}:`,
    `  agent: ${data.agentId}`,
    `  passages: ${data.passageCount}`,
  ];

  if (data.blocks.length > 0) {
    lines.push("  memory blocks:");
    for (const b of data.blocks) {
      lines.push(`    ${b.label}: ${b.chars}/${b.limit} chars`);
    }
  }

  lines.push(`  last bootstrap: ${data.lastBootstrap ?? "never"}`);
  lines.push(`  last sync: ${data.lastSyncCommit ?? "never"}`);
  lines.push(`  last sync at: ${data.lastSyncAt ?? "never"}`);

  return lines.join("\n");
}
