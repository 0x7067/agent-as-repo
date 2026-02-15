import {
  architectureBootstrapPrompt,
  conventionsBootstrapPrompt,
} from "../core/prompts.js";
import type { AgentProvider } from "./provider.js";

export async function bootstrapAgent(provider: AgentProvider, agentId: string): Promise<void> {
  await provider.sendMessage(agentId, architectureBootstrapPrompt());
  await provider.sendMessage(agentId, conventionsBootstrapPrompt());
}
