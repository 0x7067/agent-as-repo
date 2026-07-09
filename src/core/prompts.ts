const NO_TAGS_WARNING =
  "IMPORTANT: When using archival_memory_search, do NOT pass tags — just use the query parameter (path_prefix is allowed).";

export function buildPersona(
  repoName: string,
  description: string,
  customPersona?: string,
): string {
  const base = customPersona || `I am a codebase expert for the "${repoName}" repository. ${description}.`;

  const lines = [
    base,
    "I can navigate the live repository with grep_repo, glob_files, and read_file, and I also keep indexed passages in archival memory.",
    "When answering questions, first consult my architecture and conventions memory blocks.",
    "For exact identifiers, strings, or file navigation, prefer grep_repo / glob_files / read_file.",
    "For conceptual recall, use archival_memory_search (optionally with path_prefix to stage-narrow results).",
    "Be specific: name exact tools, frameworks, and versions rather than just wrapper commands.",
    NO_TAGS_WARNING,
  ];

  return lines.join("\n");
}

export function architectureBootstrapPrompt(): string {
  return [
    "Analyze the codebase. Prefer glob_files / grep_repo / read_file for structure and exact symbols; use archival_memory_search for broader recall.",
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
    "Explore coding conventions, dependencies, configuration, and API patterns via grep_repo / read_file and archival_memory_search as needed.",
    "Do NOT pass tags when using archival_memory_search.",
    "Update your 'conventions' memory block with a concise summary covering:",
    "- Key dependencies and their roles",
    "- Coding conventions and patterns",
    "- Configuration approach",
    "- CLI design and key commands",
    "Use memory_replace to update the conventions block.",
  ].join("\n");
}
