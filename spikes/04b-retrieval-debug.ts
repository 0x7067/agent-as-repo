/**
 * Phase 0 — Spike #4b: Retrieval Debug
 *
 * Tests vector search directly (not via agent) to understand
 * what archival_memory_search actually returns.
 * Then tests chunked vs whole-file passages.
 *
 * Run: pnpm tsx spikes/04b-retrieval-debug.ts
 */
import "dotenv/config";
import Letta from "@letta-ai/letta-client";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const client = new Letta();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// Simple chunker: split file by double newlines, group into ~2000 char chunks
function chunkFile(filePath: string, content: string, maxChars = 2000): string[] {
  const sections = content.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = `FILE: ${filePath}\n\n`;

  for (const section of sections) {
    if (current.length + section.length > maxChars && current.length > filePath.length + 10) {
      chunks.push(current.trim());
      current = `FILE: ${filePath} (continued)\n\n`;
    }
    current += section + "\n\n";
  }
  if (current.trim().length > filePath.length + 10) {
    chunks.push(current.trim());
  }
  return chunks;
}

async function main() {
  const agents: string[] = [];

  try {
    // === TEST A: Whole-file passages, direct search ===
    console.log("=== TEST A: Whole-file passages ===\n");
    const agentA = await client.agents.create({
      name: `spike-debug-whole-${Date.now()}`,
      model: "openai/gpt-4.1",
      embedding: "openai/text-embedding-3-small",
      memory_blocks: [{ label: "persona", value: "Test agent.", limit: 5000 }],
      tags: ["spike-test"],
    });
    agents.push(agentA.id);

    const ideaContent = await fs.readFile(path.join(PROJECT_ROOT, "idea.md"), "utf8");
    await client.agents.passages.create(agentA.id, { text: `FILE: idea.md\n\n${ideaContent}` });
    const pkgContent = await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf8");
    await client.agents.passages.create(agentA.id, { text: `FILE: package.json\n\n${pkgContent}` });
    console.log(`Loaded 2 whole-file passages (idea.md: ${ideaContent.length} chars, package.json: ${pkgContent.length} chars)`);

    // Direct vector search using passages.search
    const queries = ["core memory blocks persona architecture", "risk register SDK instability", "letta-client npm packages", "git diff incremental sync"];
    for (const q of queries) {
      console.log(`\n  Search: "${q}"`);
      const response = await client.agents.passages.search(agentA.id, { query: q });
      console.log(`  Count: ${response.count}`);
      for (const r of response.results) {
        console.log(`    [${r.id}] ${r.content?.slice(0, 120)}...`);
      }
    }

    // === TEST B: Chunked passages, direct search ===
    console.log("\n\n=== TEST B: Chunked passages ===\n");
    const agentB = await client.agents.create({
      name: `spike-debug-chunked-${Date.now()}`,
      model: "openai/gpt-4.1",
      embedding: "openai/text-embedding-3-small",
      memory_blocks: [{ label: "persona", value: "Test agent.", limit: 5000 }],
      tags: ["spike-test"],
    });
    agents.push(agentB.id);

    const ideaChunks = chunkFile("idea.md", ideaContent);
    const pkgChunks = chunkFile("package.json", pkgContent);
    console.log(`idea.md → ${ideaChunks.length} chunks, package.json → ${pkgChunks.length} chunks`);
    for (const chunk of [...ideaChunks, ...pkgChunks]) {
      await client.agents.passages.create(agentB.id, { text: chunk });
    }

    for (const q of queries) {
      console.log(`\n  Search: "${q}"`);
      const response = await client.agents.passages.search(agentB.id, { query: q });
      console.log(`  Count: ${response.count}`);
      for (const r of response.results) {
        console.log(`    [${r.id}] ${r.content?.slice(0, 120)}...`);
      }
    }

    // === TEST C: Chunked agent, full Q&A ===
    console.log("\n\n=== TEST C: Chunked agent Q&A ===\n");
    const agentC = await client.agents.create({
      name: `spike-debug-qa-${Date.now()}`,
      model: "openai/gpt-4.1",
      embedding: "openai/text-embedding-3-small",
      system: [
        "You are a codebase expert. Your archival memory contains source files from a repository.",
        "For EVERY question, search your archival memory first. Base ALL answers on what you find.",
      ].join("\n"),
      memory_blocks: [{ label: "persona", value: "Codebase expert. Always search archival memory.", limit: 5000 }],
      tags: ["spike-test"],
    });
    agents.push(agentC.id);

    const feasContent = await fs.readFile(path.join(PROJECT_ROOT, "feasibility-analysis.md"), "utf8");
    const feasChunks = chunkFile("feasibility-analysis.md", feasContent);
    console.log(`Loading: idea.md (${ideaChunks.length} chunks), feasibility (${feasChunks.length} chunks), package.json (${pkgChunks.length} chunks)`);
    const allChunks = [...ideaChunks, ...feasChunks, ...pkgChunks];
    for (const chunk of allChunks) {
      await client.agents.passages.create(agentC.id, { text: chunk });
    }
    console.log(`Total chunks loaded: ${allChunks.length}`);

    const qaTests = [
      { q: "What are the core memory blocks proposed for each agent?", expect: "persona" },
      { q: "What risks were identified? List them.", expect: "SDK instability" },
      { q: "What npm packages does the project use?", expect: "letta-client" },
      { q: "What is the incremental sync strategy?", expect: "git diff" },
    ];

    let passed = 0;
    for (const { q, expect } of qaTests) {
      console.log(`\nQ: ${q}`);
      const resp = await client.agents.messages.create(agentC.id, {
        messages: [{ role: "user", content: q }],
      });
      let answer = "";
      for (const msg of resp.messages) {
        if ((msg as any).message_type === "assistant_message") answer += (msg as any).content || "";
      }
      const found = answer.toLowerCase().includes(expect.toLowerCase());
      console.log(`  ${found ? "PASS" : "FAIL"} (expect: "${expect}")`);
      if (!found) console.log(`  Answer: ${answer.slice(0, 200)}...`);
      if (found) passed++;
    }
    console.log(`\nChunked Q&A: ${passed}/${qaTests.length} passed`);

  } catch (error) {
    console.error("\n--- TEST FAILED ---");
    console.error(error);
    process.exitCode = 1;
  } finally {
    console.log("\nCleaning up...");
    for (const id of agents) {
      try { await client.agents.delete(id); } catch {}
    }
    console.log("Done.");
  }
}

main();
