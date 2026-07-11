import type { AgentProvider } from "../ports/agent-provider.js";
import { buildOnboardPrompt } from "../core/onboard.js";
import { groundFileReferences, indexedPathsFromPassages } from "../core/grounding.js";

export interface OnboardAgentOptions {
  /** Lets the caller time out (or cancel) the onboarding walkthrough. */
  signal?: AbortSignal;
}

/**
 * Post-processes the raw onboarding walkthrough against the actual passage
 * index: strips literal `path/to/` template artifacts (the prompt's own
 * format example leaking into the model's output) and drops any file
 * recommendation whose path (after stripping) still has zero passages —
 * see src/core/grounding.ts for the pure validation logic.
 */
async function groundOnboardResult(provider: AgentProvider, agentId: string, result: string): Promise<string> {
  const passages = await provider.listPassages(agentId);
  const indexedPaths = indexedPathsFromPassages(passages);
  return groundFileReferences(result, indexedPaths).text;
}

export async function onboardAgent(
  provider: AgentProvider,
  repoName: string,
  agentId: string,
  options?: OnboardAgentOptions,
): Promise<string> {
  const prompt = buildOnboardPrompt(repoName);
  const result = options?.signal === undefined
    ? await provider.sendMessage(agentId, prompt)
    : await provider.sendMessage(agentId, prompt, { signal: options.signal });
  return groundOnboardResult(provider, agentId, result);
}
