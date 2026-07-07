import type { AgentProvider } from "../ports/agent-provider.js";
import { buildOnboardPrompt } from "../core/onboard.js";

export interface OnboardAgentOptions {
  /** Lets the caller time out (or cancel) the onboarding walkthrough. */
  signal?: AbortSignal;
}

export async function onboardAgent(
  provider: AgentProvider,
  repoName: string,
  agentId: string,
  options?: OnboardAgentOptions,
): Promise<string> {
  const prompt = buildOnboardPrompt(repoName);
  if (options?.signal === undefined) {
    return provider.sendMessage(agentId, prompt);
  }
  return provider.sendMessage(agentId, prompt, { signal: options.signal });
}
