/**
 * Phase 4 — Spike #6: Cross-Agent Messaging
 *
 * Validates: built-in `send_message_to_agents_matching_all_tags` tool
 * works for agent-to-agent communication via tag-based discovery.
 *
 * Creates two agents (Agent A and Agent B), both tagged ["spike-test"].
 * Agent A has `send_message_to_agents_matching_all_tags` tool attached.
 * Sends a message to Agent A asking it to query other agents tagged "spike-test".
 * Measures latency of the cross-agent round-trip.
 *
 * Run: pnpm tsx spikes/06-cross-agent-messaging.ts
 */
import "dotenv/config";
import Letta from "@letta-ai/letta-client";

const client = new Letta();

async function main() {
  const agentIds: string[] = [];
  const tag = `spike-cross-agent-${Date.now()}`;

  try {
    // 1. Create Agent B (the "peer" agent that will be discovered)
    console.log("1. Creating Agent B (peer)...");
    const agentB = await client.agents.create({
      name: `spike-peer-${Date.now()}`,
      model: "openai/gpt-4.1",
      embedding: "openai/text-embedding-3-small",
      memory_blocks: [
        { label: "persona", value: "I am the backend API expert. The main endpoint is POST /api/users which creates a user. Auth uses JWT tokens.", limit: 5000 },
      ],
      tags: [tag],
    });
    agentIds.push(agentB.id);
    console.log(`   Agent B created: ${agentB.id} with tag [${tag}]`);

    // 2. Create Agent A (the "caller" agent with cross-agent tool)
    console.log("2. Creating Agent A (caller with cross-agent tool)...");
    const agentA = await client.agents.create({
      name: `spike-caller-${Date.now()}`,
      model: "openai/gpt-4.1",
      embedding: "openai/text-embedding-3-small",
      memory_blocks: [
        {
          label: "persona",
          value: `I am a frontend expert. If I need information about other repositories, I use my send_message_to_agents_matching_all_tags tool with tags ["${tag}"] to ask other agents.`,
          limit: 5000,
        },
      ],
      tools: ["send_message_to_agents_matching_all_tags"],
      tags: [tag],
    });
    agentIds.push(agentA.id);
    console.log(`   Agent A created: ${agentA.id} with tag [${tag}]`);

    // 3. Send a cross-repo question to Agent A
    console.log("\n3. Sending cross-repo question to Agent A...");
    const question = `I need to know about the backend API. Use your send_message_to_agents_matching_all_tags tool with tags ["${tag}"] to ask the other agent: "What is the main API endpoint and how does authentication work?"`;

    const startMs = Date.now();
    const response = await client.agents.messages.create(agentA.id, {
      messages: [{ role: "user", content: question }],
    });
    const elapsed = Date.now() - startMs;

    console.log(`   Response received in ${elapsed}ms`);
    console.log("\n4. Full response:");
    for (const msg of response.messages) {
      const msgType = msg.message_type;
      if (msgType === "assistant_message") {
        const content = (msg as { content?: string }).content;
        console.log(`   [assistant] ${typeof content === "string" ? content : JSON.stringify(content)}`);
      } else if (msgType === "tool_call_message") {
        const toolCall = msg as { tool_call?: { name?: string; arguments?: string } };
        console.log(`   [tool_call] ${toolCall.tool_call?.name}(${toolCall.tool_call?.arguments})`);
      } else if (msgType === "tool_return_message") {
        const toolReturn = msg as { tool_return?: string };
        const text = toolReturn.tool_return ?? "";
        console.log(`   [tool_return] ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}`);
      } else {
        console.log(`   [${msgType}]`);
      }
    }

    // 5. Verify cross-agent communication happened
    const hasToolCall = response.messages.some((m) => m.message_type === "tool_call_message");
    const hasToolReturn = response.messages.some((m) => m.message_type === "tool_return_message");

    console.log("\n5. Validation:");
    console.log(`   Tool call made: ${hasToolCall ? "YES" : "NO"}`);
    console.log(`   Tool return received: ${hasToolReturn ? "YES" : "NO"}`);
    console.log(`   Total latency: ${elapsed}ms`);

    if (hasToolCall && hasToolReturn) {
      console.log("\n   PASS: Cross-agent messaging works via send_message_to_agents_matching_all_tags");
    } else {
      console.log("\n   INCONCLUSIVE: Agent may not have used the cross-agent tool.");
      console.log("   This could mean the LLM chose to answer directly without consulting peers.");
    }
  } finally {
    // Cleanup
    console.log("\n6. Cleaning up...");
    for (const id of agentIds) {
      try {
        await client.agents.delete(id);
        console.log(`   Deleted agent ${id}`);
      } catch {
        console.warn(`   Warning: could not delete agent ${id}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("Spike failed:", err);
  process.exit(1);
});
