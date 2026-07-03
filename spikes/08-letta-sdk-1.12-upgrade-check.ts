/**
 * Spike #8 — Letta SDK 1.7.8 → 1.12.1 upgrade check
 *
 * Exercises every SDK method used by:
 *   - src/shell/letta-provider.ts
 *   - src/shell/adapters/letta-admin-adapter.ts
 *
 * Uses an isolated 1.12.1 install via NODE_PATH so the repo's pinned dependency stays untouched.
 *
 * Setup once:
 *   mkdir -p /tmp/letta-sdk-1121 && cd /tmp/letta-sdk-1121 && npm init -y && npm install @letta-ai/letta-client@1.12.1
 *
 * Run (offline):
 *   NODE_PATH=/tmp/letta-sdk-1121/node_modules tsx spikes/08-letta-sdk-1.12-upgrade-check.ts
 *
 * Run (live):
 *   NODE_PATH=/tmp/letta-sdk-1121/node_modules LETTA_API_KEY=... tsx spikes/08-letta-sdk-1.12-upgrade-check.ts
 */
import Letta from "@letta-ai/letta-client";

const client = new Letta({ baseURL: process.env["LETTA_BASE_URL"] });

function getClientPath(root: unknown, path: string): unknown {
  let value: unknown = root;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null) return null;
    value = Reflect.get(value, key);
  }
  return value;
}

function assertMethodsExist(): void {
  const paths = [
    "agents.create",
    "agents.delete",
    "agents.update",
    "agents.list",
    "agents.retrieve",
    "agents.passages.create",
    "agents.passages.delete",
    "agents.passages.list",
    "agents.passages.search",
    "agents.blocks.retrieve",
    "agents.blocks.update",
    "agents.messages.create",
  ];

  for (const path of paths) {
    if (typeof getClientPath(client, path) !== "function") {
      throw new TypeError(`Missing SDK method: ${path}`);
    }
  }
  console.log(`All ${String(paths.length)} required methods present`);
}

async function runLiveSmoke(): Promise<void> {
  let agentId: string | undefined;

  try {
    console.log("Live smoke: creating agent with enable_sleeptime + archival_memory_search...");
    const agent = await client.agents.create({
      name: `spike-sdk-1121-${Date.now()}`,
      model: "openai/gpt-4.1",
      embedding: "openai/text-embedding-3-small",
      enable_sleeptime: true,
      tools: ["archival_memory_search"],
      memory_blocks: [
        { label: "persona", value: "SDK 1.12.1 upgrade spike agent.", limit: 5000 },
        { label: "architecture", value: "Not yet analyzed.", limit: 5000 },
        { label: "conventions", value: "Not yet analyzed.", limit: 5000 },
      ],
      tags: ["spike-test", "sdk-1.12.1"],
    });
    agentId = agent.id;
    console.log(`  agent.id=${agent.id}`);

    console.log("Live smoke: passages.create/list/search/delete...");
    const created = await client.agents.passages.create(agentId, {
      text: "FILE: src/example.ts\n\nexport function hello() { return 'world'; }",
    });
    const passageId = created[0]?.id;
    console.log(`  passageId=${passageId ?? "(missing)"}`);

    const listed = await client.agents.passages.list(agentId, { limit: 10, ascending: true });
    console.log(`  list count=${listed.length}`);

    const search = await client.agents.passages.search(agentId, { query: "hello function", top_k: 3 });
    console.log(`  search count=${search.count}, first result id=${search.results[0]?.id ?? "(none)"}`);

    if (passageId) {
      await client.agents.passages.delete(passageId, { agent_id: agentId });
    }

    console.log("Live smoke: blocks.retrieve/update...");
    const persona = await client.agents.blocks.retrieve("persona", { agent_id: agentId });
    console.log(`  persona.label=${persona.label}`);
    await client.agents.blocks.update("architecture", {
      agent_id: agentId,
      value: "Upgrade spike updated architecture block.",
    });

    console.log("Live smoke: agents.update(enable_sleeptime)...");
    await client.agents.update(agentId, { enable_sleeptime: true });

    console.log("Live smoke: messages.create...");
    const response = await client.agents.messages.create(agentId, {
      messages: [{ role: "user", content: "Reply with the word OK only." }],
    });
    console.log(`  messages returned=${response.messages.length}`);

    console.log("Live smoke: agents.list pagination...");
    let listedAgents = 0;
    for await (const _agent of client.agents.list()) {
      listedAgents++;
      if (listedAgents >= 3) break;
    }
    console.log(`  agents.list sampled=${listedAgents}`);

    console.log("Live smoke: agents.retrieve...");
    const retrieved = await client.agents.retrieve(agentId);
    console.log(`  retrieve name=${retrieved.name}`);

    console.log("\n--- LIVE SMOKE PASSED (SDK 1.12.1) ---");
  } finally {
    if (agentId) {
      console.log(`Cleaning up agent ${agentId}...`);
      try {
        await client.agents.delete(agentId);
      } catch (error) {
        console.error("Failed to delete agent:", error);
      }
    }
  }
}

async function main(): Promise<void> {
  console.log("Letta SDK spike — upgrade path check for 1.12.1");
  assertMethodsExist();

  if (!process.env["LETTA_API_KEY"]) {
    console.log("\nLETTA_API_KEY not set — skipping live smoke (offline verification only).");
    console.log("--- OFFLINE CHECK PASSED ---");
    return;
  }

  await runLiveSmoke();
}

main().catch((error: unknown) => {
  console.error("\n--- SPIKE FAILED ---");
  console.error(error);
  process.exitCode = 1;
});
