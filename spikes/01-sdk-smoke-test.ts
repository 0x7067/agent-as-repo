/**
 * Phase 0 — Spike #1: SDK Smoke Test
 *
 * Validates: create agent with 3 custom memory blocks, insert a passage,
 * send a message, read a block back, clean up.
 *
 * Run: pnpm tsx spikes/01-sdk-smoke-test.ts
 */
import "dotenv/config";
import Letta from "@letta-ai/letta-client";

const client = new Letta(); // auto-reads LETTA_API_KEY from env

async function main() {
  let agentId: string | undefined;

  try {
    // 1. Create agent with 3 custom memory blocks
    console.log("1. Creating agent with 3 memory blocks...");
    const agent = await client.agents.create({
      name: `spike-smoke-test-${Date.now()}`,
      model: "openai/gpt-4.1",
      embedding: "openai/text-embedding-3-small",
      memory_blocks: [
        { label: "persona", value: "I am a test agent for SDK validation.", limit: 5000 },
        { label: "architecture", value: "Not yet analyzed.", limit: 5000 },
        { label: "conventions", value: "Not yet analyzed.", limit: 5000 },
      ],
      tags: ["spike-test"],
    });
    agentId = agent.id;
    console.log(`   Agent created: ${agent.id}`);
    console.log(`   Name: ${agent.name}`);
    console.log(`   Tags: ${JSON.stringify(agent.tags)}`);

    // 2. Insert a passage into archival memory
    console.log("\n2. Inserting passage into archival memory...");
    const passages = await client.agents.passages.create(agentId, {
      text: "FILE: src/index.ts\n\nexport function hello() {\n  return 'world';\n}",
    });
    console.log(`   Passages created: ${JSON.stringify(passages).slice(0, 200)}`);

    // Extract passage ID (response is an array)
    const passageId = Array.isArray(passages) ? passages[0]?.id : (passages as any).id;
    console.log(`   Passage ID: ${passageId}`);

    // 3. List passages to confirm it's there
    console.log("\n3. Listing agent passages...");
    const passageList = await client.agents.passages.list(agentId);
    console.log(`   Total passages: ${Array.isArray(passageList) ? passageList.length : "unknown"}`);

    // 4. Send a message to the agent
    console.log("\n4. Sending message to agent...");
    const response = await client.agents.messages.create(agentId, {
      messages: [{ role: "user", content: "What files do you know about? Search your archival memory." }],
    });
    console.log(`   Response messages: ${response.messages.length}`);
    for (const msg of response.messages) {
      const type = (msg as any).message_type ?? "unknown";
      if (type === "assistant_message" || type === "tool_call_message") {
        console.log(`   [${type}] ${JSON.stringify(msg).slice(0, 300)}`);
      }
    }

    // 5. Read a memory block back
    console.log("\n5. Reading 'persona' memory block...");
    const personaBlock = await client.agents.blocks.retrieve("persona", { agent_id: agentId });
    console.log(`   Block label: ${personaBlock.label}`);
    console.log(`   Block value: ${personaBlock.value?.slice(0, 200)}`);
    console.log(`   Block limit: ${personaBlock.limit}`);

    // 6. Update a memory block
    console.log("\n6. Updating 'architecture' block...");
    await client.agents.blocks.update("architecture", {
      agent_id: agentId,
      value: "Single file project. Entry point: src/index.ts. Exports hello().",
    });
    const archBlock = await client.agents.blocks.retrieve("architecture", { agent_id: agentId });
    console.log(`   Updated value: ${archBlock.value}`);

    // 7. Delete the passage
    console.log("\n7. Deleting passage...");
    if (passageId) {
      await client.agents.passages.delete(passageId, { agent_id: agentId });
      console.log("   Passage deleted.");
      const afterDelete = await client.agents.passages.list(agentId);
      console.log(`   Passages remaining: ${Array.isArray(afterDelete) ? afterDelete.length : "unknown"}`);
    }

    console.log("\n--- SMOKE TEST PASSED ---");
  } catch (err) {
    console.error("\n--- SMOKE TEST FAILED ---");
    console.error(err);
    process.exitCode = 1;
  } finally {
    // Cleanup: delete the agent
    if (agentId) {
      console.log(`\nCleaning up agent ${agentId}...`);
      try {
        await client.agents.delete(agentId);
        console.log("Agent deleted.");
      } catch {
        console.error("Failed to delete agent.");
      }
    }
  }
}

main();
