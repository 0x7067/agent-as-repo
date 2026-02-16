import type { AgentProvider } from "./provider.js";
import { buildOnboardPrompt } from "../core/onboard.js";

export async function onboardAgent(
  provider: AgentProvider,
  repoName: string,
  agentId: string,
): Promise<string> {
  const prompt = buildOnboardPrompt(repoName);
  return provider.sendMessage(agentId, prompt);
}
