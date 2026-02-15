/**
 * Quick spike: list agent tools and available tools
 */
import "dotenv/config";
import Letta from "@letta-ai/letta-client";

const client = new Letta();

async function main() {
  let agentId: string | undefined;

  try {
    // Create agent
    const agent = await client.agents.create({
      name: `spike-tools-${Date.now()}`,
      model: "openai/gpt-4.1",
      embedding: "openai/text-embedding-3-small",
      memory_blocks: [
        { label: "persona", value: "Test agent.", limit: 5000 },
        { label: "human", value: "Test user.", limit: 5000 },
      ],
      tags: ["spike-test"],
    });
    agentId = agent.id;

    // List agent's tools
    console.log("=== Agent tools ===");
    const tools = agent.tools ?? [];
    for (const tool of tools) {
      console.log(`  ${(tool as any).name ?? (tool as any).id ?? JSON.stringify(tool).slice(0, 100)}`);
    }

    // List all available tools
    console.log("\n=== All available tools ===");
    const allTools = await client.tools.list();
    for await (const tool of allTools) {
      console.log(`  ${tool.name} (${tool.id})`);
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    if (agentId) {
      try { await client.agents.delete(agentId); } catch {}
    }
  }
}

main();
