/** Blocks and sync context needed to build a consolidation prompt. */
export interface ConsolidationPromptInput {
  /** Current 'architecture' memory block text. */
  architecture: string;
  /** Current 'conventions' memory block text. */
  conventions: string;
  /** Files touched by the sync that triggered consolidation (may be empty for a manual run). */
  changedFiles: string[];
  /** Count of files re-indexed by the sync. */
  filesReIndexed: number;
  /** Count of files removed by the sync. */
  filesRemoved: number;
  /** Max characters allowed per memory block. */
  blockCharLimit: number;
  /** Formatted git log evidence (see `formatGitEvidence`); omitted when unavailable. */
  gitEvidence?: string;
}

/** Cap the number of changed-file paths listed in the prompt to keep it bounded. */
const MAX_LISTED_FILES = 50;

/**
 * Build the user prompt for a single memory-consolidation turn.
 *
 * Pure: embeds the current architecture/conventions blocks and the changed-file
 * summary directly, because the consolidation turn exposes only `memory_replace`
 * (no archival search). The closing instruction names the tool and forbids
 * touching the persona block.
 */
export function buildConsolidationPrompt(input: ConsolidationPromptInput): string {
  const { architecture, conventions, changedFiles, filesReIndexed, filesRemoved, blockCharLimit, gitEvidence } = input;

  const listed = changedFiles.slice(0, MAX_LISTED_FILES);
  const overflow = changedFiles.length - listed.length;

  const changedSection: string[] =
    changedFiles.length === 0
      ? ["No specific files were provided — refine the blocks against their current contents."]
      : [
          `A sync re-indexed ${String(filesReIndexed)} file(s) and removed ${String(filesRemoved)} file(s).`,
          "Changed files:",
          ...listed.map((file) => `- ${file}`),
          ...(overflow > 0 ? [`- ...and ${String(overflow)} more`] : []),
        ];

  const gitEvidenceSection: string[] =
    gitEvidence === undefined || gitEvidence.length === 0
      ? []
      : [
          "",
          "Commit log since the last sync — treat as ground truth for what changed",
          gitEvidence,
        ];

  return [
    "You are refreshing the long-lived memory blocks for a codebase expert after a repository sync.",
    "Update the 'architecture' and 'conventions' blocks so they reflect the current state of the code.",
    "",
    ...changedSection,
    ...gitEvidenceSection,
    "",
    "## Current architecture block",
    architecture.trim().length > 0 ? architecture : "(empty)",
    "",
    "## Current conventions block",
    conventions.trim().length > 0 ? conventions : "(empty)",
    "",
    "Rules:",
    `- Keep each block under ${String(blockCharLimit)} characters.`,
    "- Preserve accurate existing content; only revise what the changes affect. Do NOT discard useful information.",
    "- If a block already reflects reality, leave it unchanged.",
    "Use memory_replace to update the architecture and/or conventions block. Do NOT modify the persona block.",
  ].join("\n");
}

/** Sync outcome fields consulted when deciding whether to consolidate. */
export interface ConsolidationDecisionInput {
  filesReIndexed: number;
  filesRemoved: number;
}

/** Minimum files touched (re-indexed + removed) before a sync consolidates. */
export const CONSOLIDATE_MIN_FILES_CHANGED = 5;

/**
 * Decide whether a completed sync should trigger memory consolidation.
 *
 * Stateless: gates on the opt-in flag and on the number of files the sync
 * actually touched (re-indexed + removed) meeting the built-in minimum.
 */
export function shouldConsolidate(
  sync: ConsolidationDecisionInput,
  consolidateOnSync: boolean,
): boolean {
  if (!consolidateOnSync) return false;
  const filesChanged = sync.filesReIndexed + sync.filesRemoved;
  return filesChanged >= CONSOLIDATE_MIN_FILES_CHANGED;
}
