const NO_TAGS_WARNING =
  "IMPORTANT: When using archival_memory_search, do NOT pass tags — just use the query parameter (path_prefix is allowed).";

/**
 * Negative-space grounding rule: the core defense against hallucinated
 * features/files. Repeated on every surface that reaches the model (persona,
 * agentic CLI guidance) rather than left to model luck — see E2E findings
 * doc 2026-07-11, finding 4 (gin's fabricated rate limiter, express's
 * fabricated lib/router/index.js, --fast's invented `flask create`).
 */
const NEGATIVE_SPACE_RULE =
  "If archival_memory_search (or live repo tools) returns no supporting evidence for a claimed feature, file, or behavior, say explicitly that it does not appear to exist in this repository. Never describe the internals of a file, function, or feature you have not actually retrieved evidence for — do not guess a plausible-sounding implementation.";

/** Ephemeral guidance appended to the system prompt for standalone CLI ask only. */
export function agenticSearchGuidance(): string {
  return [
    "## Live repo tools (standalone CLI)",
    "For known symbol names, prefer find_symbol (definition locations, ranked by repo-map importance).",
    "For exact identifiers, strings, or file navigation, prefer grep_repo / glob_files / read_file.",
    "For conceptual recall, use archival_memory_search (optionally with path_prefix to stage-narrow results).",
    NEGATIVE_SPACE_RULE,
  ].join("\n");
}

export function buildPersona(
  repoName: string,
  description: string,
  customPersona?: string,
): string {
  const base = customPersona || `I am a codebase expert for the "${repoName}" repository. ${description}.`;

  const lines = [
    base,
    "I keep durable project knowledge in architecture/conventions memory blocks and indexed passages in archival memory.",
    "When answering questions, first consult my architecture and conventions memory blocks, then use archival_memory_search for supporting details (optionally with path_prefix to stage-narrow results).",
    "Be specific: name exact tools, frameworks, and versions rather than just wrapper commands.",
    NO_TAGS_WARNING,
    NEGATIVE_SPACE_RULE,
  ];

  return lines.join("\n");
}

export function architectureBootstrapPrompt(): string {
  return [
    "Analyze the codebase via archival_memory_search (and live repo tools if available).",
    "Do NOT pass tags when using archival_memory_search.",
    "Then update your 'architecture' memory block with a concise summary (under 4000 chars) covering:",
    "- Project name and purpose",
    "- Directory structure",
    "- Key architectural patterns",
    "- Technology stack",
    "- How components interact",
    "Only include directories and files you actually found evidence for via archival_memory_search or live repo tools — do not invent paths that didn't come back in a search result.",
    "Use memory_replace to update the architecture block.",
  ].join("\n");
}

export function conventionsBootstrapPrompt(): string {
  return [
    "Search archival memory (and live repo tools if available) for coding conventions, dependencies, configuration, and API patterns.",
    "Do NOT pass tags when using archival_memory_search.",
    "Update your 'conventions' memory block with a concise summary covering:",
    "- Key dependencies and their roles",
    "- Coding conventions and patterns",
    "- Configuration approach",
    "- CLI design and key commands",
    "Use memory_replace to update the conventions block.",
  ].join("\n");
}
