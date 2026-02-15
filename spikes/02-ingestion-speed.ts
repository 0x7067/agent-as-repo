/**
 * Phase 0 — Spike #2: Ingestion Speed
 *
 * Measures passage insertion timing at 100, 500, and 1000 passages.
 * Tests sequential vs concurrent (p=5, p=10, p=20) insertion.
 *
 * Run: pnpm tsx spikes/02-ingestion-speed.ts
 */
import "dotenv/config";
import Letta from "@letta-ai/letta-client";

const client = new Letta();

function fakeFile(i: number): string {
  return `FILE: src/components/Component${i}.tsx\n\nimport React from 'react';\n\nexport function Component${i}() {\n  return <div>Component ${i}</div>;\n}\n`;
}

async function insertSequential(agentId: string, count: number): Promise<number> {
  const start = Date.now();
  for (let i = 0; i < count; i++) {
    await client.agents.passages.create(agentId, { text: fakeFile(i) });
  }
  return Date.now() - start;
}

async function insertConcurrent(agentId: string, count: number, concurrency: number): Promise<number> {
  const start = Date.now();
  const queue = Array.from({ length: count }, (_, i) => i);
  let idx = 0;

  async function worker() {
    while (idx < queue.length) {
      const i = idx++;
      await client.agents.passages.create(agentId, { text: fakeFile(i) });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return Date.now() - start;
}

async function createAgent(label: string): Promise<string> {
  const agent = await client.agents.create({
    name: `spike-ingestion-${label}-${Date.now()}`,
    model: "openai/gpt-4.1",
    embedding: "openai/text-embedding-3-small",
    memory_blocks: [
      { label: "persona", value: "Ingestion speed test agent.", limit: 5000 },
    ],
    tags: ["spike-test"],
  });
  return agent.id;
}

async function deleteAgent(agentId: string) {
  try { await client.agents.delete(agentId); } catch {}
}

async function main() {
  const results: Array<{ test: string; count: number; ms: number; perPassage: number }> = [];
  const agents: string[] = [];

  try {
    // Test 1: Sequential 100
    console.log("Test 1: Sequential 100 passages...");
    const a1 = await createAgent("seq100");
    agents.push(a1);
    const t1 = await insertSequential(a1, 100);
    results.push({ test: "sequential", count: 100, ms: t1, perPassage: t1 / 100 });
    console.log(`   ${t1}ms total, ${(t1 / 100).toFixed(0)}ms/passage`);

    // Test 2: Concurrent p=5, 100 passages
    console.log("Test 2: Concurrent p=5, 100 passages...");
    const a2 = await createAgent("p5-100");
    agents.push(a2);
    const t2 = await insertConcurrent(a2, 100, 5);
    results.push({ test: "concurrent-p5", count: 100, ms: t2, perPassage: t2 / 100 });
    console.log(`   ${t2}ms total, ${(t2 / 100).toFixed(0)}ms/passage`);

    // Test 3: Concurrent p=10, 100 passages
    console.log("Test 3: Concurrent p=10, 100 passages...");
    const a3 = await createAgent("p10-100");
    agents.push(a3);
    const t3 = await insertConcurrent(a3, 100, 10);
    results.push({ test: "concurrent-p10", count: 100, ms: t3, perPassage: t3 / 100 });
    console.log(`   ${t3}ms total, ${(t3 / 100).toFixed(0)}ms/passage`);

    // Test 4: Concurrent p=20, 100 passages
    console.log("Test 4: Concurrent p=20, 100 passages...");
    const a4 = await createAgent("p20-100");
    agents.push(a4);
    const t4 = await insertConcurrent(a4, 100, 20);
    results.push({ test: "concurrent-p20", count: 100, ms: t4, perPassage: t4 / 100 });
    console.log(`   ${t4}ms total, ${(t4 / 100).toFixed(0)}ms/passage`);

    // Test 5: Best concurrency, 500 passages
    // Pick the best concurrency from tests 2-4
    const best = [results[1], results[2], results[3]].sort((a, b) => a.perPassage - b.perPassage)[0];
    const bestP = best.test === "concurrent-p5" ? 5 : best.test === "concurrent-p10" ? 10 : 20;
    console.log(`\nBest concurrency so far: ${best.test} (${best.perPassage.toFixed(0)}ms/passage)`);
    console.log(`Test 5: Concurrent p=${bestP}, 500 passages...`);
    const a5 = await createAgent(`p${bestP}-500`);
    agents.push(a5);
    const t5 = await insertConcurrent(a5, 500, bestP);
    results.push({ test: `concurrent-p${bestP}-500`, count: 500, ms: t5, perPassage: t5 / 500 });
    console.log(`   ${t5}ms total, ${(t5 / 500).toFixed(0)}ms/passage`);

    // Test 6: Best concurrency, 1000 passages
    console.log(`Test 6: Concurrent p=${bestP}, 1000 passages...`);
    const a6 = await createAgent(`p${bestP}-1000`);
    agents.push(a6);
    const t6 = await insertConcurrent(a6, 1000, bestP);
    results.push({ test: `concurrent-p${bestP}-1000`, count: 1000, ms: t6, perPassage: t6 / 1000 });
    console.log(`   ${t6}ms total, ${(t6 / 1000).toFixed(0)}ms/passage`);

    // Summary
    console.log("\n=== INGESTION SPEED RESULTS ===");
    console.log("Test                     | Count | Total (s) | Per Passage (ms)");
    console.log("-".repeat(70));
    for (const r of results) {
      console.log(
        `${r.test.padEnd(24)} | ${String(r.count).padStart(5)} | ${(r.ms / 1000).toFixed(1).padStart(9)} | ${r.perPassage.toFixed(0).padStart(16)}`
      );
    }

    // Extrapolation
    const bestRate = results[results.length - 1].perPassage;
    console.log(`\nExtrapolated times at best rate (${bestRate.toFixed(0)}ms/passage):`);
    for (const n of [1000, 3000, 5000, 10000]) {
      const est = (n * bestRate) / 1000;
      console.log(`   ${n} files → ~${est.toFixed(0)}s (${(est / 60).toFixed(1)} min)`);
    }
  } catch (err) {
    console.error("\n--- INGESTION SPEED TEST FAILED ---");
    console.error(err);
    process.exitCode = 1;
  } finally {
    console.log("\nCleaning up agents...");
    for (const id of agents) {
      await deleteAgent(id);
    }
    console.log("Done.");
  }
}

main();
