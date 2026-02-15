import type Letta from "@letta-ai/letta-client";

export async function queryAgent(
  client: Letta,
  agentId: string,
  question: string,
): Promise<string> {
  const resp = await client.agents.messages.create(agentId, {
    messages: [{ role: "user", content: question }],
  });

  for (const msg of resp.messages) {
    if ((msg as any).message_type === "assistant_message") {
      return (msg as any).content ?? "";
    }
  }

  return "";
}
