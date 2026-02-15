/**
 * Phase 0 — Spike #4e: Force Archival Memory Search
 *
 * Tests whether the agent uses archival_memory_search when explicitly told to.
 * Also tests tool_rules to enforce archival search.
 *
 * Run: pnpm tsx spikes/04e-archival-search.ts
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
    // Create agent with persona that emphasizes archival memory
    const agent = await client.agents.create({
      name: `spike-archival-${Date.now()}`,
      model: "openai/gpt-4.1",
      embedding: "openai/text-embedding-3-small",
      memory_blocks: [
        {
          label: "persona",
          value: [
            "I am a codebase expert for the repo-expert-agents project.",
            "All project source files are stored in my ARCHIVAL memory (not conversation memory).",
            "When asked about the codebase, I MUST use archival_memory_search (NOT conversation_search).",
            "I never guess or use general knowledge. I only answer based on archival memory search results.",
          ].join("\n"),
          limit: 5000,
        },
        { label: "human", value: "Developer working on repo-expert-agents.", limit: 5000 },
      ],
      tags: ["spike-test"],
    });
    agentId = agent.id;
    console.log(`Agent: ${agentId}`);

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

    // Test questions with explicit archival search instruction
    const questions = [
      "Use archival_memory_search to find what core memory blocks are proposed for each agent. What are their labels and limits?",
      "Use archival_memory_search to find the risk register. List the risks that were identified.",
      "Use archival_memory_search to find package.json. What npm packages does this project use?",
      "Use archival_memory_search to find the incremental sync strategy. How does git diff fit in?",
    ];

    let passed = 0;
    const expects = ["persona", "SDK instability", "letta-client", "git diff"];

    for (let i = 0; i < questions.length; i++) {
      console.log(`\nQ: ${questions[i]}`);
      const resp = await client.agents.messages.create(agentId, {
        messages: [{ role: "user", content: questions[i] }],
      });

      let answer = "";
      let usedArchival = false;
      for (const msg of resp.messages) {
        const type = (msg as any).message_type;
        if (type === "tool_call_message") {
          const toolName = (msg as any).tool_call?.name || "";
          const args = (msg as any).tool_call?.arguments || "";
          console.log(`  [tool_call] ${toolName}(${args.slice(0, 100)})`);
          if (toolName === "archival_memory_search") usedArchival = true;
        } else if (type === "tool_return_message") {
          const ret = (msg as any).tool_return || "";
          console.log(`  [tool_return] ${ret.slice(0, 200)}`);
        } else if (type === "assistant_message") {
          answer = (msg as any).content || "";
          console.log(`  [assistant] ${answer.slice(0, 300)}`);
        }
      }

      const found = answer.toLowerCase().includes(expects[i].toLowerCase());
      console.log(`  Used archival: ${usedArchival} | Found "${expects[i]}": ${found}`);
      if (found) passed++;
    }

    console.log(`\n=== RESULTS: ${passed}/${questions.length} passed ===`);
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
