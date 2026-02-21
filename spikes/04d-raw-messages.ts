/**
 * Phase 0 — Spike #4d: Raw Message Debug
 *
 * Logs raw message JSON to understand exactly what the agent does
 * when searching archival memory.
 *
 * Run: pnpm tsx spikes/04d-raw-messages.ts
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
      name: `spike-raw-${Date.now()}`,
      model: "openai/gpt-4.1",
      embedding: "openai/text-embedding-3-small",
      memory_blocks: [
        {
          label: "persona",
          value: "I am a codebase expert. I always search archival memory before answering.",
          limit: 5000,
        },
        { label: "human", value: "Developer on repo-expert-agents.", limit: 5000 },
      ],
      tags: ["spike-test"],
    });
    agentId = agent.id;

    // Load just a few chunks
    const pkgContent = await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf8");
    await client.agents.passages.create(agentId, { text: `FILE: package.json\n\n${pkgContent}` });

    const ideaContent = await fs.readFile(path.join(PROJECT_ROOT, "idea.md"), "utf8");
    const chunks = chunkFile("idea.md", ideaContent).slice(0, 3); // just first 3 chunks
    for (const chunk of chunks) {
      await client.agents.passages.create(agentId, { text: chunk });
    }
    console.log(`Loaded ${chunks.length + 1} passages`);

    // Verify search works via API
    console.log("\n--- Direct API search ---");
    const apiResults = await client.agents.passages.search(agentId, { query: "npm packages dependencies" });
    console.log(`API search results: ${apiResults.count}`);
    for (const r of apiResults.results) {
      console.log(`  ${r.content?.slice(0, 100)}`);
    }

    // Ask the agent
    console.log("\n--- Agent query (raw messages) ---");
    const resp = await client.agents.messages.create(agentId, {
      messages: [{ role: "user", content: "What npm packages does this project use? Search your archival memory for package.json." }],
    });

    console.log(`\nTotal messages: ${resp.messages.length}`);
    for (let i = 0; i < resp.messages.length; i++) {
      const msg = resp.messages[i];
      console.log(`\n--- Message ${i} ---`);
      console.log(JSON.stringify(msg, null, 2).slice(0, 1000));
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
