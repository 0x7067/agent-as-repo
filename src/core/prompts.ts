const NO_TAGS_WARNING =
  "IMPORTANT: When using archival_memory_search, do NOT pass tags — just use the query parameter.";

export function buildPersona(
  repoName: string,
  description: string,
  customPersona?: string,
): string {
  const base = customPersona || `I am a codebase expert for the "${repoName}" repository. ${description}.`;

  const lines = [
    base,
    "All project source files are stored in my archival memory.",
    "When answering questions, first consult my architecture and conventions memory blocks, then search archival memory for supporting details.",
    "Be specific: name exact tools, frameworks, and versions rather than just wrapper commands.",
    NO_TAGS_WARNING,
  ];

  return lines.join("\n");
}

export function architectureBootstrapPrompt(): string {
  return [
    "Analyze the codebase in your archival memory. Search for architecture, project structure, and design patterns.",
    "Do NOT pass tags when using archival_memory_search.",
    "Then update your 'architecture' memory block with a concise summary (under 4000 chars) covering:",
    "- Project name and purpose",
    "- Directory structure",
    "- Key architectural patterns",
    "- Technology stack",
    "- How components interact",
    "Use memory_replace to update the architecture block.",
  ].join("\n");
}

export function conventionsBootstrapPrompt(): string {
  return [
    "Search your archival memory for coding conventions, dependencies, configuration, and API patterns.",
    "Do NOT pass tags when using archival_memory_search.",
    "Update your 'conventions' memory block with a concise summary covering:",
    "- Key dependencies and their roles",
    "- Coding conventions and patterns",
    "- Configuration approach",
    "- CLI design and key commands",
    "Use memory_replace to update the conventions block.",
  ].join("\n");
}
