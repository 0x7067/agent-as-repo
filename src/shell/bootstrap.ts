import type Letta from "@letta-ai/letta-client";
import {
  architectureBootstrapPrompt,
  conventionsBootstrapPrompt,
} from "../core/prompts.js";

export async function bootstrapAgent(client: Letta, agentId: string): Promise<void> {
  await client.agents.messages.create(agentId, {
    messages: [{ role: "user", content: architectureBootstrapPrompt() }],
  });

  await client.agents.messages.create(agentId, {
    messages: [{ role: "user", content: conventionsBootstrapPrompt() }],
  });
}
