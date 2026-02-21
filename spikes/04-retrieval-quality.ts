/**
 * Phase 0 — Spike #4: Retrieval Quality
 *
 * Loads this project's own files into an agent's archival memory,
 * then tests whether the agent can answer known-answer questions
 * using archival search.
 *
 * Run: pnpm tsx spikes/04-retrieval-quality.ts
 */
import "dotenv/config";
import Letta from "@letta-ai/letta-client";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const client = new Letta();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// Files to load (from this project itself)
const FILES_TO_LOAD = [
  "idea.md",
  "feasibility-analysis.md",
  "spikes/01-sdk-smoke-test.ts",
  "spikes/02-ingestion-speed.ts",
  "spikes/03-passage-lifecycle.ts",
  "package.json",
  "tsconfig.json",
];

// Known-answer questions: each question has an expected substring in the answer
const QUESTIONS: Array<{ q: string; expectInArchival: string; description: string }> = [
  {
    q: "What are the core memory blocks proposed for each agent?",
    expectInArchival: "persona",
    description: "Should find memory block design in idea.md",
  },
  {
    q: "What is the recommended concurrency level for passage ingestion?",
    expectInArchival: "p-limit",
    description: "Should find concurrency discussion in idea.md or feasibility",
  },
  {
    q: "What npm packages are used in this project?",
    expectInArchival: "letta-client",
    description: "Should find dependencies in package.json",
  },
  {
    q: "What risks were identified for this project?",
    expectInArchival: "SDK instability",
    description: "Should find risk register in idea.md or feasibility",
  },
  {
    q: "How does the passage delete API work? What parameters does it take?",
    expectInArchival: "passage",
    description: "Should find passage delete usage in spike scripts",
  },
  {
    q: "What is the incremental sync strategy for updating files?",
    expectInArchival: "git diff",
    description: "Should find sync design in idea.md",
  },
  {
    q: "What model and embedding are used for agent creation?",
    expectInArchival: "gpt-4",
    description: "Should find model config in idea.md or spikes",
  },
  {
    q: "What alternative approaches to this project were considered?",
    expectInArchival: "Greptile",
    description: "Should find alternatives in feasibility analysis",
  },
];

async function main() {
  let agentId: string | undefined;

  try {
    // 1. Create agent
    console.log("Creating test agent...");
    const agent = await client.agents.create({
      name: `spike-retrieval-${Date.now()}`,
      model: "openai/gpt-4.1",
      embedding: "openai/text-embedding-3-small",
      system: [
        "You are a codebase expert agent. Your archival memory contains source files from a repository.",
        "IMPORTANT: For EVERY question, you MUST search your archival memory using archival_memory_search BEFORE answering.",
        "NEVER answer from general knowledge. ALL your answers must be grounded in the files stored in your archival memory.",
        "If you cannot find relevant information in archival memory, say so explicitly.",
      ].join("\n"),
      memory_blocks: [
        { label: "persona", value: "I am a codebase expert. I always search archival memory before answering.", limit: 5000 },
      ],
      tags: ["spike-test"],
    });
    agentId = agent.id;
    console.log(`   Agent: ${agent.id}`);

    // 2. Load files
    console.log("\nLoading files into archival memory...");
    const passageIds: string[] = [];
    for (const file of FILES_TO_LOAD) {
      const fullPath = path.join(PROJECT_ROOT, file);
      const content = await fs.readFile(fullPath, "utf8");
      const result = await client.agents.passages.create(agentId, {
        text: `FILE: ${file}\n\n${content}`,
      });
      const id = Array.isArray(result) ? result[0]?.id : (result as any).id;
      passageIds.push(id);
      console.log(`   ${file} (${content.length} chars) → ${id}`);
    }
    console.log(`   Total passages loaded: ${passageIds.length}`);

    // 3. Test questions via agent messages
    console.log("\n=== RETRIEVAL QUALITY TEST ===\n");
    let passed = 0;
    let failed = 0;

    for (const { q, expectInArchival, description } of QUESTIONS) {
      console.log(`Q: ${q}`);
      console.log(`   Expected: should reference "${expectInArchival}"`);

      const response = await client.agents.messages.create(agentId, {
        messages: [{ role: "user", content: q }],
      });

      // Extract assistant message content
      let assistantContent = "";
      for (const msg of response.messages) {
        const type = (msg as any).message_type;
        if (type === "assistant_message") {
          assistantContent += (msg as any).content || "";
        }
      }

      const found = assistantContent.toLowerCase().includes(expectInArchival.toLowerCase());
      if (found) {
        console.log(`   PASS — found "${expectInArchival}" in response`);
        passed++;
      } else {
        console.log(`   FAIL — "${expectInArchival}" not found in response`);
        console.log(`   Response preview: ${assistantContent.slice(0, 200)}...`);
        failed++;
      }
      console.log();
    }

    console.log("=== RESULTS ===");
    console.log(`Passed: ${passed}/${QUESTIONS.length}`);
    console.log(`Failed: ${failed}/${QUESTIONS.length}`);
    console.log(`Hit rate: ${((passed / QUESTIONS.length) * 100).toFixed(0)}%`);

    if (failed > 0) {
      console.log("\nNote: failures may be due to the agent not searching archival memory,");
      console.log("or the search not returning relevant passages. Check agent behavior.");
    }
  } catch (error) {
    console.error("\n--- RETRIEVAL QUALITY TEST FAILED ---");
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (agentId) {
      console.log(`\nCleaning up agent ${agentId}...`);
      try { await client.agents.delete(agentId); console.log("Agent deleted."); } catch {}
    }
  }
}

main();
