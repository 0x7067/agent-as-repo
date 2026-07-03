import { buildConsolidationPrompt } from "../core/consolidate.js";
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
  signal?: AbortSignal;
  log?: (msg: string) => void;
}

export interface ConsolidateAgentMemoryResult {
  consolidated: boolean;
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
  const { provider, agentId, changedFiles, syncResult, blockCharLimit, signal, log } = params;

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
    });

    await provider.consolidateMemory(agentId, prompt, {
      blockCharLimit,
      ...(signal === undefined ? {} : { signal }),
    });

    return { consolidated: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log?.(`  Warning: memory consolidation failed: ${message}`);
    return { consolidated: false, error: message };
  }
}
