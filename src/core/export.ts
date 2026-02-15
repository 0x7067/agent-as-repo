export interface ExportBlock {
  label: string;
  value: string;
}

export interface ExportData {
  repoName: string;
  agentId: string;
  blocks: ExportBlock[];
  files: string[];
}

export function formatExport(data: ExportData): string {
  const lines: string[] = [
    `# ${data.repoName}`,
    "",
    `Agent: \`${data.agentId}\``,
    "",
  ];

  for (const block of data.blocks) {
    lines.push(`## ${block.label}`, "", block.value, "");
  }

  lines.push(`## Files (${data.files.length})`, "");
  for (const file of data.files) {
    lines.push(`- \`${file}\``);
  }

  return lines.join("\n");
}
