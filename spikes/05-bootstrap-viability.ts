/**
 * Phase 0 — Spike #5: Bootstrap Viability
 *
 * Tests whether an agent can analyze its own archival memory
 * and self-populate core memory blocks with useful summaries.
 *
 * Run: pnpm tsx spikes/05-bootstrap-viability.ts
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

async function main() {
  let agentId: string | undefined;

  try {
    const agent = await client.agents.create({
      name: `spike-bootstrap-${Date.now()}`,
      model: "openai/gpt-4.1",
      embedding: "openai/text-embedding-3-small",
      tools: ["archival_memory_search"],
      memory_blocks: [
        {
          label: "persona",
          value: "I am a codebase expert. I analyze repositories stored in my archival memory.",
          limit: 5000,
        },
        { label: "architecture", value: "Not yet analyzed.", limit: 5000 },
        { label: "conventions", value: "Not yet analyzed.", limit: 5000 },
      ],
      tags: ["spike-test"],
    });
    agentId = agent.id;
    console.log(`Agent: ${agentId}`);

    // Load project files
    const files = ["idea.md", "feasibility-analysis.md", "package.json", "tsconfig.json"];
    let totalChunks = 0;
    for (const file of files) {
      const content = await fs.readFile(path.join(PROJECT_ROOT, file), "utf8");
      const chunks = chunkFile(file, content);
      for (const chunk of chunks) {
        await client.agents.passages.create(agentId, { text: chunk });
      }
      totalChunks += chunks.length;
    }
    console.log(`Loaded ${totalChunks} chunks from ${files.length} files`);

    // Read blocks before bootstrap
    console.log("\n=== BEFORE BOOTSTRAP ===");
    const archBefore = await client.agents.blocks.retrieve("architecture", { agent_id: agentId });
    const convBefore = await client.agents.blocks.retrieve("conventions", { agent_id: agentId });
    console.log(`architecture: ${archBefore.value}`);
    console.log(`conventions: ${convBefore.value}`);

    // Bootstrap prompt: ask agent to analyze and self-populate
    console.log("\n=== BOOTSTRAP: Analyzing architecture ===");
    const archResp = await client.agents.messages.create(agentId, {
      messages: [{
        role: "user",
        content: [
          "Analyze the codebase in your archival memory. Search for architecture, project structure, and design patterns.",
          "When using archival_memory_search, do NOT pass tags — just use the query.",
          "Then update your 'architecture' memory block with a concise summary (under 4000 chars) covering:",
          "- Project name and purpose",
          "- Directory structure",
          "- Key architectural patterns",
          "- Technology stack",
          "- How components interact",
          "Use memory_replace to update the architecture block.",
        ].join("\n"),
      }],
    });

    // Log what the agent did
    for (const msg of archResp.messages) {
      const type = (msg as any).message_type;
      if (type === "tool_call_message") {
        const name = (msg as any).tool_call?.name || "";
        const args = (msg as any).tool_call?.arguments || "";
        console.log(`  [tool] ${name}(${args.slice(0, 120)}...)`);
      } else if (type === "assistant_message") {
        console.log(`  [assistant] ${((msg as any).content || "").slice(0, 200)}`);
      }
    }

    console.log("\n=== BOOTSTRAP: Analyzing conventions ===");
    const convResp = await client.agents.messages.create(agentId, {
      messages: [{
        role: "user",
        content: [
          "Now search your archival memory for coding conventions, dependencies, and API patterns.",
          "When using archival_memory_search, do NOT pass tags.",
          "Update your 'conventions' memory block with a concise summary covering:",
          "- Key dependencies and their roles",
          "- Coding conventions and patterns",
          "- Configuration approach",
          "- CLI design",
          "Use memory_replace to update the conventions block.",
        ].join("\n"),
      }],
    });

    for (const msg of convResp.messages) {
      const type = (msg as any).message_type;
      if (type === "tool_call_message") {
        const name = (msg as any).tool_call?.name || "";
        const args = (msg as any).tool_call?.arguments || "";
        console.log(`  [tool] ${name}(${args.slice(0, 120)}...)`);
      } else if (type === "assistant_message") {
        console.log(`  [assistant] ${((msg as any).content || "").slice(0, 200)}`);
      }
    }

    // Read blocks after bootstrap
    console.log("\n=== AFTER BOOTSTRAP ===");
    const archAfter = await client.agents.blocks.retrieve("architecture", { agent_id: agentId });
    const convAfter = await client.agents.blocks.retrieve("conventions", { agent_id: agentId });

    console.log("\n--- architecture block ---");
    console.log(archAfter.value);
    console.log(`\n(${archAfter.value?.length ?? 0} chars)`);

    console.log("\n--- conventions block ---");
    console.log(convAfter.value);
    console.log(`\n(${convAfter.value?.length ?? 0} chars)`);

    // Validate
    const archUpdated = archAfter.value !== "Not yet analyzed.";
    const convUpdated = convAfter.value !== "Not yet analyzed.";
    console.log(`\n=== BOOTSTRAP RESULTS ===`);
    console.log(`Architecture block updated: ${archUpdated}`);
    console.log(`Conventions block updated: ${convUpdated}`);

    if (archUpdated && convUpdated) {
      console.log("\n--- BOOTSTRAP VIABILITY: PASSED ---");
    } else {
      console.log("\n--- BOOTSTRAP VIABILITY: PARTIAL ---");
    }

  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (agentId) {
      try { await client.agents.delete(agentId); } catch {}
    }
  }
}

main();
