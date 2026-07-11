import {
  architectureBootstrapPrompt,
  conventionsBootstrapPrompt,
} from "../core/prompts.js";
import { groundFileReferences, indexedPathsFromPassages } from "../core/grounding.js";
import type { AgentProvider } from "../ports/agent-provider.js";

/** Blocks that bootstrap writes to, and that are therefore worth re-validating. */
const GROUNDED_BLOCK_LABELS = ["architecture", "conventions"] as const;

/**
 * Re-validates the architecture/conventions blocks the bootstrap turns just
 * wrote: any concrete `` `file/path.ext` `` reference with zero passages in
 * the store is dropped (line-level), so a hallucinated file can't survive
 * bootstrap and propagate into every later ask/onboard. Directory-only
 * claims (e.g. "/tests") are intentionally left alone — see
 * src/core/grounding.ts.
 */
async function groundBootstrapBlocks(provider: AgentProvider, agentId: string): Promise<void> {
  const passages = await provider.listPassages(agentId);
  const indexedPaths = indexedPathsFromPassages(passages);

  for (const label of GROUNDED_BLOCK_LABELS) {
    const block = await provider.getBlock(agentId, label);
    const grounded = groundFileReferences(block.value, indexedPaths);
    if (grounded.changed) {
      await provider.updateBlock(agentId, label, grounded.text);
    }
  }
}

export async function bootstrapAgent(provider: AgentProvider, agentId: string): Promise<void> {
  await provider.sendMessage(agentId, architectureBootstrapPrompt());
  await provider.sendMessage(agentId, conventionsBootstrapPrompt());
  await groundBootstrapBlocks(provider, agentId);
}
