import { buildConsolidationPrompt } from "../core/consolidate.js";
import { fingerprintBlocks } from "../core/fingerprint.js";
import type { AgentProvider } from "../ports/agent-provider.js";

export interface ConsolidateAgentMemoryParams {
  provider: AgentProvider;
  agentId: string;
  /** Files touched by the triggering sync (empty for a manual run). */
  changedFiles: string[];
  /** Sync outcome counts used to describe the change in the prompt. */
  syncResult: { filesReIndexed: number; filesRemoved: number };
  /** Max characters allowed per memory block. */
  blockCharLimit: number;
  /** Formatted git log evidence (see `formatGitEvidence`); omitted when unavailable. */
  gitEvidence?: string;
  /** Formatted PageRank symbol evidence; omitted when unavailable. */
  symbolRankEvidence?: string;
  signal?: AbortSignal;
  log?: (msg: string) => void;
}

export interface ConsolidateAgentMemoryResult {
  consolidated: boolean;
  /** False when the post-consolidation blocks fingerprint identically to the pre-consolidation blocks (no-op). */
  changed: boolean;
  error?: string;
}

/**
 * Consolidate an agent's architecture/conventions blocks after a sync.
 *
 * Non-fatal by contract: any failure is caught and logged so it can never fail
 * the sync. The provider's restricted turn guarantees the old blocks are kept
 * when the model returns nothing usable, so a swallowed error never makes
 * memory worse.
 */
export async function consolidateAgentMemory(
  params: ConsolidateAgentMemoryParams,
): Promise<ConsolidateAgentMemoryResult> {
  const { provider, agentId, changedFiles, syncResult, blockCharLimit, gitEvidence, symbolRankEvidence, signal, log } = params;

  try {
    const [architecture, conventions] = await Promise.all([
      provider.getBlock(agentId, "architecture"),
      provider.getBlock(agentId, "conventions"),
    ]);

    const prompt = buildConsolidationPrompt({
      architecture: architecture.value,
      conventions: conventions.value,
      changedFiles,
      filesReIndexed: syncResult.filesReIndexed,
      filesRemoved: syncResult.filesRemoved,
      blockCharLimit,
      ...(gitEvidence === undefined ? {} : { gitEvidence }),
      ...(symbolRankEvidence === undefined || symbolRankEvidence.length === 0
        ? {}
        : { symbolRankEvidence }),
    });

    await provider.consolidateMemory(agentId, prompt, {
      blockCharLimit,
      ...(signal === undefined ? {} : { signal }),
    });

    const [postArchitecture, postConventions] = await Promise.all([
      provider.getBlock(agentId, "architecture"),
      provider.getBlock(agentId, "conventions"),
    ]);

    const preHash = fingerprintBlocks({ architecture: architecture.value, conventions: conventions.value });
    const postHash = fingerprintBlocks({ architecture: postArchitecture.value, conventions: postConventions.value });

    if (preHash === postHash) {
      log?.(`  consolidation: blocks unchanged`);
      return { consolidated: true, changed: false };
    }

    return { consolidated: true, changed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log?.(`  Warning: memory consolidation failed: ${message}`);
    return { consolidated: false, changed: false, error: message };
  }
}
