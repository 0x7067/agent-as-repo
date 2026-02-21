/**
 * Spike: Verify enable_sleeptime works with Letta Cloud API.
 *
 * Tests:
 * 1. Create agent with enable_sleeptime: true
 * 2. Send a message, verify response
 * 3. Check if memory blocks get updated by sleep-time agent
 * 4. Clean up
 *
 * Run: pnpm tsx spikes/sleeptime-spike.ts
 */
import "dotenv/config";
import { Letta } from "@letta-ai/letta-client";

const client = new Letta({ token: process.env.LETTA_API_KEY });

async function main() {
  console.log("1. Creating agent with enable_sleeptime=true...");
  const agent = await client.agents.create({
    name: `sleeptime-spike-${Date.now()}`,
    model: "openai/gpt-4.1",
    embedding: "openai/text-embedding-3-small",
    enable_sleeptime: true,
    tools: ["archival_memory_search"],
    memory_blocks: [
      { label: "persona", value: "You are a code expert.", limit: 5000 },
      { label: "architecture", value: "Not yet analyzed.", limit: 5000 },
    ],
  });
  console.log(`   Agent created: ${agent.id}`);

  // Check the agent state for sleeptime config
  console.log(`   Agent type: ${agent.agent_type}`);
  console.log(`   Multi-agent group: ${agent.multi_agent_group ? JSON.stringify(agent.multi_agent_group) : "none"}`);

  try {
    console.log("\n2. Sending first message...");
    const resp1 = await client.agents.messages.create(agent.id, {
      messages: [{ role: "user", content: "Tell me about TypeScript generics in 2 sentences." }],
    });
    const assistantMsg = resp1.messages.find((m) => m.message_type === "assistant_message");
    if (assistantMsg && "content" in assistantMsg) {
      console.log(`   Response: ${String(assistantMsg.content).slice(0, 200)}`);
    }

    console.log("\n3. Checking memory blocks...");
    const personaBlock = await client.agents.blocks.retrieve("persona", { agent_id: agent.id });
    console.log(`   persona (${personaBlock.value.length} chars): ${personaBlock.value.slice(0, 200)}`);
    const archBlock = await client.agents.blocks.retrieve("architecture", { agent_id: agent.id });
    console.log(`   architecture (${archBlock.value.length} chars): ${archBlock.value.slice(0, 200)}`);

    const questions = [
      "How do mapped types work in TypeScript?",
      "Explain conditional types with infer.",
      "What are template literal types?",
      "How does the satisfies operator work?",
      "What's the difference between type and interface?",
    ];
    for (const [i, question] of questions.entries()) {
      console.log(`\n4.${i + 1}. Sending message: "${question.slice(0, 50)}..."`);
      const resp = await client.agents.messages.create(agent.id, {
        messages: [{ role: "user", content: question }],
      });
      const msg = resp.messages.find((m) => m.message_type === "assistant_message");
      if (msg && "content" in msg) {
        console.log(`   Response: ${String(msg.content).slice(0, 150)}`);
      }
    }

    // Wait for sleep-time agent to process
    console.log("\n5. Waiting 30s for sleep-time agent background processing...");
    await new Promise((r) => setTimeout(r, 30_000));

    console.log("   Re-checking memory blocks...");
    const personaAfter = await client.agents.blocks.retrieve("persona", { agent_id: agent.id });
    console.log(`   persona (${personaAfter.value.length} chars): ${personaAfter.value.slice(0, 200)}`);
    const archAfter = await client.agents.blocks.retrieve("architecture", { agent_id: agent.id });
    console.log(`   architecture (${archAfter.value.length} chars): ${archAfter.value.slice(0, 200)}`);

    const personaChanged = personaAfter.value !== personaBlock.value;
    const archChanged = archAfter.value !== archBlock.value;
    console.log(`\n   Memory blocks changed by sleep-time agent? persona=${personaChanged}, architecture=${archChanged}`);

  } finally {
    console.log("\n6. Cleaning up...");
    await client.agents.delete(agent.id);
    console.log("   Agent deleted.");
  }
}

main().catch((error) => {
  console.error("Spike failed:", error);
  process.exit(1);
});
