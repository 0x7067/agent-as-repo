/** Marker-delimited block injected into a repo's CLAUDE.md/AGENTS.md, pointing
 * coding agents at the repo-expert MCP tools. Markers make the splice
 * deterministic and idempotent — no LLM judgment needed to find "our" section. */
export const INSTRUCTIONS_START_MARKER = "<!-- repo-expert:start -->";
export const INSTRUCTIONS_END_MARKER = "<!-- repo-expert:end -->";

export interface RenderInstructionsBlockInput {
  repoNames: string[];
}

export interface SpliceResult {
  content: string;
  changed: boolean;
  warning?: string;
}

export function renderInstructionsBlock(input: RenderInstructionsBlockInput): string {
  return [
    INSTRUCTIONS_START_MARKER,
    "## Repo Expert",
    "",
    "This repository is indexed by a repo-expert agent with continuously synced",
    "semantic memory (MCP server: `repo-expert`).",
    "",
    "Before broad codebase exploration, prefer these MCP tools:",
    "- `agent_call` — ask the expert a question about this codebase",
    "- `agent_search_archival` — semantic + lexical search over indexed passages",
    "",
    `Indexed repos: ${input.repoNames.join(", ")}`,
    INSTRUCTIONS_END_MARKER,
  ].join("\n");
}

function trimTrailingNewlines(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "\n") end--;
  return value.slice(0, end);
}

function trimLeadingNewlines(value: string): string {
  let start = 0;
  while (start < value.length && value[start] === "\n") start++;
  return value.slice(start);
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function toContent(existing: string | null): string {
  if (existing === null) return "";
  return existing;
}

export function spliceInstructionsBlock(existing: string | null, block: string): SpliceResult {
  const current = toContent(existing);
  const startIdx = current.indexOf(INSTRUCTIONS_START_MARKER);

  if (startIdx === -1) {
    const next = current.trim().length === 0
      ? ensureTrailingNewline(block)
      : `${trimTrailingNewlines(current)}\n\n${ensureTrailingNewline(block)}`;
    return { content: next, changed: next !== current };
  }

  const endIdx = current.indexOf(INSTRUCTIONS_END_MARKER, startIdx);
  if (endIdx === -1) {
    const next = trimTrailingNewlines(current.slice(0, startIdx)).length === 0
      ? ensureTrailingNewline(block)
      : `${trimTrailingNewlines(current.slice(0, startIdx))}\n\n${ensureTrailingNewline(block)}`;
    return {
      content: next,
      changed: next !== current,
      warning: "Existing repo-expert instructions block was missing its end marker; replaced through end of file.",
    };
  }

  const before = current.slice(0, startIdx);
  const after = current.slice(endIdx + INSTRUCTIONS_END_MARKER.length);
  const next = before + block + after;
  return { content: next, changed: next !== current };
}

function joinAroundRemovedBlock(before: string, after: string): string {
  if (before.length === 0) return after;
  if (after.length === 0) return `${before}\n`;
  return `${before}\n\n${after}`;
}

export function removeInstructionsBlock(existing: string | null): SpliceResult {
  const current = toContent(existing);
  const startIdx = current.indexOf(INSTRUCTIONS_START_MARKER);
  if (startIdx === -1) {
    return { content: current, changed: false };
  }

  const endIdx = current.indexOf(INSTRUCTIONS_END_MARKER, startIdx);
  const removeEnd = endIdx === -1 ? current.length : endIdx + INSTRUCTIONS_END_MARKER.length;

  const before = trimTrailingNewlines(current.slice(0, startIdx));
  const after = trimLeadingNewlines(current.slice(removeEnd));
  const next = joinAroundRemovedBlock(before, after);

  return { content: next, changed: next !== current };
}
