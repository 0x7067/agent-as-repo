import type { AgentProvider } from "./provider.js";

export async function queryAgent(
  provider: AgentProvider,
  agentId: string,
  question: string,
): Promise<string> {
  return provider.sendMessage(agentId, question);
}
