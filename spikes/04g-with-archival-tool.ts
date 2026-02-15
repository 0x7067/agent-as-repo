/**
 * Phase 0 — Spike #4g: Agent with archival_memory_search tool
 *
 * Run: pnpm tsx spikes/04g-with-archival-tool.ts
 */
import "dotenv/config";
import Letta from "@letta-ai/letta-client";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const client = new Letta();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

function chunkFile(filePath: string, content: string, maxChars = 2000): string[] {
  const sections = content.split(/\n\n+/);
  const chunks: string[] = [];
  let current = `FILE: ${filePath}\n\n`;
  for (const section of sections) {
    if (current.length + section.length > maxChars && current.length > filePath.length + 10) {
      chunks.push(current.trim());
      current = `FILE: ${filePath} (continued)\n\n`;
    }
    current += section + "\n\n";
  }
  if (current.trim().length > filePath.length + 10) chunks.push(current.trim());
  return chunks;
}

async function main() {
  let agentId: string | undefined;

  try {
    const agent = await client.agents.create({
      name: `spike-archival-tool-${Date.now()}`,
      model: "openai/gpt-4.1",
      embedding: "openai/text-embedding-3-small",
      tools: ["archival_memory_search"],
      memory_blocks: [
        {
          label: "persona",
          value: [
            "I am a codebase expert for the repo-expert-agents project.",
            "All project source files are stored in my archival memory.",
            "I always search archival memory to answer questions about the codebase.",
            "IMPORTANT: When using archival_memory_search, do NOT pass tags — just use the query parameter.",
          ].join("\n"),
          limit: 5000,
        },
        { label: "human", value: "Developer on repo-expert-agents.", limit: 5000 },
      ],
      tags: ["spike-test"],
    });
    agentId = agent.id;

    // Confirm tools
    console.log("Agent tools:");
    for (const t of agent.tools ?? []) console.log(`  ${(t as any).name}`);

    // Load chunks
    const ideaContent = await fs.readFile(path.join(PROJECT_ROOT, "idea.md"), "utf-8");
    const feasContent = await fs.readFile(path.join(PROJECT_ROOT, "feasibility-analysis.md"), "utf-8");
    const pkgContent = await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf-8");
    const allChunks = [
      ...chunkFile("idea.md", ideaContent),
      ...chunkFile("feasibility-analysis.md", feasContent),
      ...chunkFile("package.json", pkgContent),
    ];
    for (const chunk of allChunks) {
      await client.agents.passages.create(agentId, { text: chunk });
    }
    console.log(`Loaded ${allChunks.length} chunks`);

    // Test questions
    const tests = [
      { q: "What are the core memory blocks proposed for each agent? Search your archival memory.", expect: "persona" },
      { q: "What risks were identified for this project? Search archival memory.", expect: "SDK instability" },
      { q: "What npm packages does this project use? Search archival memory for package.json.", expect: "letta-client" },
      { q: "What is the incremental sync strategy? Search archival memory.", expect: "git diff" },
    ];

    let passed = 0;
    for (const { q, expect } of tests) {
      console.log(`\nQ: ${q}`);
      const resp = await client.agents.messages.create(agentId, {
        messages: [{ role: "user", content: q }],
      });

      let answer = "";
      for (const msg of resp.messages) {
        const type = (msg as any).message_type;
        if (type === "tool_call_message") {
          const name = (msg as any).tool_call?.name || "";
          const args = (msg as any).tool_call?.arguments || "";
          console.log(`  [tool] ${name}(${args.slice(0, 100)})`);
        } else if (type === "tool_return_message") {
          const ret = (msg as any).tool_return || "";
          console.log(`  [return] ${ret.slice(0, 200)}`);
        } else if (type === "assistant_message") {
          answer = (msg as any).content || "";
          console.log(`  [answer] ${answer.slice(0, 400)}`);
        }
      }

      const found = answer.toLowerCase().includes(expect.toLowerCase());
      console.log(`  ${found ? "PASS" : "FAIL"} (expect: "${expect}")`);
      if (found) passed++;
    }

    console.log(`\n=== RESULTS: ${passed}/${tests.length} passed ===`);
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
