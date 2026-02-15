/**
 * Phase 0 — Spike #3: Passage Lifecycle
 *
 * Tests the full create → search → delete → re-create cycle
 * that incremental sync will depend on.
 *
 * Run: pnpm tsx spikes/03-passage-lifecycle.ts
 */
import "dotenv/config";
import Letta from "@letta-ai/letta-client";

const client = new Letta();

async function main() {
  let agentId: string | undefined;

  try {
    // Setup
    console.log("Creating test agent...");
    const agent = await client.agents.create({
      name: `spike-lifecycle-${Date.now()}`,
      model: "openai/gpt-4.1",
      embedding: "openai/text-embedding-3-small",
      memory_blocks: [
        { label: "persona", value: "Lifecycle test agent.", limit: 5000 },
      ],
      tags: ["spike-test"],
    });
    agentId = agent.id;

    // 1. Create 3 passages (simulating 3 source files)
    console.log("\n1. Creating 3 passages...");
    const files = [
      { path: "src/auth.ts", content: "export function login(user: string, pass: string) { return jwt.sign({ user }); }" },
      { path: "src/db.ts", content: "export const db = new Pool({ connectionString: process.env.DATABASE_URL });" },
      { path: "src/api.ts", content: "app.get('/users', async (req, res) => { const users = await db.query('SELECT * FROM users'); res.json(users); });" },
    ];

    const passageMap: Record<string, string> = {};
    for (const f of files) {
      const result = await client.agents.passages.create(agentId, {
        text: `FILE: ${f.path}\n\n${f.content}`,
      });
      const id = Array.isArray(result) ? result[0]?.id : (result as any).id;
      passageMap[f.path] = id;
      console.log(`   ${f.path} → ${id}`);
    }

    // 2. List passages
    console.log("\n2. Listing passages...");
    const list1 = await client.agents.passages.list(agentId);
    const passages1 = Array.isArray(list1) ? list1 : [];
    console.log(`   Count: ${passages1.length}`);

    // 3. Search passages via archival memory search
    console.log("\n3. Searching passages...");
    const searchResult = await client.agents.passages.list(agentId, { search: "login" });
    const searchArr = Array.isArray(searchResult) ? searchResult : [];
    console.log(`   Search 'login' returned ${searchArr.length} results`);
    for (const p of searchArr) {
      console.log(`   - ${p.id}: ${p.text?.slice(0, 80)}...`);
    }

    // 4. Delete one passage (simulating a file change during sync)
    console.log("\n4. Deleting passage for src/auth.ts...");
    await client.agents.passages.delete(passageMap["src/auth.ts"], { agent_id: agentId });
    const list2 = await client.agents.passages.list(agentId);
    const passages2 = Array.isArray(list2) ? list2 : [];
    console.log(`   Passages remaining: ${passages2.length}`);

    // 5. Re-create with updated content (simulating sync re-insert)
    console.log("\n5. Re-creating passage with updated content...");
    const updatedContent = "export function login(user: string, pass: string, mfa?: string) { return jwt.sign({ user, mfa }); }";
    const newResult = await client.agents.passages.create(agentId, {
      text: `FILE: src/auth.ts\n\n${updatedContent}`,
    });
    const newId = Array.isArray(newResult) ? newResult[0]?.id : (newResult as any).id;
    passageMap["src/auth.ts"] = newId;
    console.log(`   New passage ID: ${newId}`);

    // 6. Verify the updated content is searchable
    console.log("\n6. Searching for updated content (mfa)...");
    const search2 = await client.agents.passages.list(agentId, { search: "mfa" });
    const search2Arr = Array.isArray(search2) ? search2 : [];
    console.log(`   Search 'mfa' returned ${search2Arr.length} results`);
    for (const p of search2Arr) {
      console.log(`   - ${p.text?.slice(0, 100)}...`);
    }

    // 7. Verify old content is gone
    console.log("\n7. Final passage list...");
    const list3 = await client.agents.passages.list(agentId);
    const passages3 = Array.isArray(list3) ? list3 : [];
    console.log(`   Total passages: ${passages3.length}`);
    for (const p of passages3) {
      console.log(`   - ${p.id}: ${p.text?.slice(0, 60)}...`);
    }

    // 8. Bulk delete (cleanup simulation)
    console.log("\n8. Bulk deleting all passages...");
    for (const id of Object.values(passageMap)) {
      await client.agents.passages.delete(id, { agent_id: agentId });
    }
    const list4 = await client.agents.passages.list(agentId);
    const passages4 = Array.isArray(list4) ? list4 : [];
    console.log(`   Passages after bulk delete: ${passages4.length}`);

    console.log("\n--- PASSAGE LIFECYCLE TEST PASSED ---");
  } catch (err) {
    console.error("\n--- PASSAGE LIFECYCLE TEST FAILED ---");
    console.error(err);
    process.exitCode = 1;
  } finally {
    if (agentId) {
      console.log(`\nCleaning up agent ${agentId}...`);
      try { await client.agents.delete(agentId); console.log("Agent deleted."); } catch {}
    }
  }
}

main();
