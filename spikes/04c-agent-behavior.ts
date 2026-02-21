/**
 * Phase 0 — Spike #4c: Agent Behavior Debug
 *
 * Tests whether the agent actually uses archival_memory_search.
 * Compares default system prompt vs custom.
 * Logs all message types to understand agent reasoning.
 *
 * Run: pnpm tsx spikes/04c-agent-behavior.ts
 */
import "dotenv/config";
import Letta from "@letta-ai/letta-client";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const client = new Letta();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

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
  if (current.trim().length > filePath.length + 10) chunks.push(current.trim());
  return chunks;
}

async function loadChunks(agentId: string) {
  const ideaContent = await fs.readFile(path.join(PROJECT_ROOT, "idea.md"), "utf8");
  const feasContent = await fs.readFile(path.join(PROJECT_ROOT, "feasibility-analysis.md"), "utf8");
  const pkgContent = await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf8");
  const chunks = [
    ...chunkFile("idea.md", ideaContent),
    ...chunkFile("feasibility-analysis.md", feasContent),
    ...chunkFile("package.json", pkgContent),
  ];
  for (const chunk of chunks) {
    await client.agents.passages.create(agentId, { text: chunk });
  }
  return chunks.length;
}

async function askAndLog(agentId: string, question: string) {
  console.log(`\nQ: ${question}`);
  const resp = await client.agents.messages.create(agentId, {
    messages: [{ role: "user", content: question }],
  });

  let answer = "";
  for (const msg of resp.messages) {
    const type = (msg as any).message_type ?? "unknown";
    const content = (msg as any).content || (msg as any).tool_call?.function?.name || "";
    const args = (msg as any).tool_call?.function?.arguments || "";

    switch (type) {
    case "tool_call_message": {
      console.log(`  [${type}] ${content}(${typeof args === "string" ? args.slice(0, 150) : JSON.stringify(args).slice(0, 150)})`);
    
    break;
    }
    case "tool_return_message": {
      const retContent = typeof content === "string" ? content : JSON.stringify(content);
      console.log(`  [${type}] ${retContent.slice(0, 200)}`);
    
    break;
    }
    case "assistant_message": {
      answer = content;
      console.log(`  [${type}] ${content.slice(0, 300)}`);
    
    break;
    }
    case "reasoning_message": 
    case "hidden_reasoning_message": {
      console.log(`  [${type}] ${(content || "").slice(0, 150)}`);
    
    break;
    }
    default: {
      console.log(`  [${type}] ${JSON.stringify(msg).slice(0, 200)}`);
    }
    }
  }
  return answer;
}

async function main() {
  const agents: string[] = [];

  try {
    // === TEST A: Default system prompt (no custom system) ===
    console.log("=== TEST A: Default system prompt ===\n");
    const agentA = await client.agents.create({
      name: `spike-behavior-default-${Date.now()}`,
      model: "openai/gpt-4.1",
      embedding: "openai/text-embedding-3-small",
      memory_blocks: [
        { label: "persona", value: "I am a codebase expert for the repo-expert-agents project. My archival memory contains the project's source files, design docs, and configuration.", limit: 5000 },
        { label: "human", value: "The user is a developer working on the repo-expert-agents project.", limit: 5000 },
      ],
      tags: ["spike-test"],
    });
    agents.push(agentA.id);

    // Print system prompt
    console.log(`Agent system prompt (first 500 chars):`);
    console.log(`${agentA.system?.slice(0, 500)}...`);
    console.log();

    const count = await loadChunks(agentA.id);
    console.log(`Loaded ${count} chunks`);

    await askAndLog(agentA.id, "Search your archival memory for information about core memory blocks. What labels and limits are proposed?");
    await askAndLog(agentA.id, "Search your archival memory for the risk register. What risks were identified?");

    // === TEST B: Default system prompt with explicit instruction in persona ===
    console.log("\n\n=== TEST B: Enhanced persona ===\n");
    const agentB = await client.agents.create({
      name: `spike-behavior-persona-${Date.now()}`,
      model: "openai/gpt-4.1",
      embedding: "openai/text-embedding-3-small",
      memory_blocks: [
        {
          label: "persona",
          value: [
            "I am a codebase expert for the repo-expert-agents project.",
            "My archival memory contains the project's source files, design docs, and configuration.",
            "I ALWAYS use archival_memory_search to find information before answering any question.",
            "I never rely on general knowledge — only on what's in my archival memory.",
          ].join("\n"),
          limit: 5000,
        },
        { label: "human", value: "The user is a developer working on the repo-expert-agents project.", limit: 5000 },
      ],
      tags: ["spike-test"],
    });
    agents.push(agentB.id);

    const countB = await loadChunks(agentB.id);
    console.log(`Loaded ${countB} chunks`);

    await askAndLog(agentB.id, "What are the core memory blocks proposed for each agent? Search your memory.");
    await askAndLog(agentB.id, "What risks were identified for this project? Search your memory and list them.");
    await askAndLog(agentB.id, "What npm packages does this project use? Check package.json in your memory.");
    await askAndLog(agentB.id, "What is the incremental sync strategy? Search for git diff in your memory.");

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
