/**
 * Spike #7: Letta Folders API
 *
 * Tests the Folders API as an alternative to manual chunking + archival passages.
 * Uploads real repo files to a folder, attaches to an agent, and compares
 * retrieval quality against our current archival_memory_search approach.
 *
 * Run: pnpm tsx spikes/07-folders-api.ts
 */
import "dotenv/config";
import Letta from "@letta-ai/letta-client";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const client = new Letta();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

const FOLDER_NAME = `spike-folders-${Date.now()}`;

/** Files to upload — small, representative set. */
const TEST_FILES = [
  "src/core/types.ts",
  "src/core/chunker.ts",
  "src/core/filter.ts",
  "src/shell/provider.ts",
  "package.json",
];

/** Poll until all files in a folder reach a terminal status. */
async function waitForProcessing(
  folderId: string,
  maxWaitMs = 120_000,
  pollMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const page = await client.folders.files.list(folderId, { limit: 50 });
    const files = page.items;

    const pending = files.filter(
      (f) => f.processing_status !== "completed" && f.processing_status !== "error",
    );

    if (pending.length === 0) {
      const errors = files.filter((f) => f.processing_status === "error");
      if (errors.length > 0) {
        for (const e of errors) {
          console.error(`  ERROR processing ${e.file_name}: ${e.error_message}`);
        }
      }
      return;
    }

    const statuses = files.map((f) => `${f.file_name}: ${f.processing_status}`);
    console.log(`  Waiting... ${statuses.join(", ")}`);

    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error(`Files not processed after ${maxWaitMs}ms`);
}

async function main() {
  let folderId: string | undefined;
  let agentId: string | undefined;

  try {
    // 1. Create folder
    console.log(`1. Creating folder "${FOLDER_NAME}"...`);
    const folder = await client.folders.create({
      name: FOLDER_NAME,
      description: "Spike: testing Folders API for repo file ingestion",
    });
    folderId = folder.id;
    console.log(`   Folder ID: ${folderId}`);
    console.log(`   Embedding config: ${JSON.stringify(folder.embedding_config)}`);

    // 2. Upload files
    console.log("\n2. Uploading files...");
    for (const relPath of TEST_FILES) {
      const absPath = path.join(PROJECT_ROOT, relPath);
      try {
        await fs.access(absPath);
      } catch {
        console.log(`   SKIP ${relPath} (not found)`);
        continue;
      }

      const result = await client.folders.files.upload(folderId, {
        file: createReadStream(absPath),
        name: relPath,
        duplicate_handling: "replace",
      });
      console.log(`   Uploaded ${relPath} → ${result.id} (${result.processing_status})`);
    }

    // 3. Wait for processing
    console.log("\n3. Waiting for server-side processing...");
    await waitForProcessing(folderId);

    // List final file states
    const filesPage = await client.folders.files.list(folderId, { limit: 50 });
    console.log("   Final file states:");
    for (const f of filesPage.items) {
      console.log(
        `   ${f.file_name}: ${f.processing_status} (${f.chunks_embedded}/${f.total_chunks} chunks)`,
      );
    }

    // 4. Create agent and attach folder
    console.log("\n4. Creating agent...");
    const agent = await client.agents.create({
      name: `spike-folders-agent-${Date.now()}`,
      model: "openai/gpt-4.1",
      embedding: "openai/text-embedding-3-small",
      memory_blocks: [
        {
          label: "persona",
          value: [
            "I am a codebase expert.",
            "I have access to project files via attached folders.",
            "I use grep, search_files, and open tools to find information.",
          ].join("\n"),
          limit: 5000,
        },
        { label: "human", value: "Developer asking about the codebase.", limit: 5000 },
      ],
      tags: ["spike-test"],
    });
    agentId = agent.id;
    console.log(`   Agent ID: ${agentId}`);

    // List tools before attach
    const toolsBefore = (agent.tools ?? []).map((t) => t.name);
    console.log(`   Tools before attach: ${JSON.stringify(toolsBefore)}`);

    // Attach folder
    console.log("\n5. Attaching folder to agent...");
    await client.agents.folders.attach(folderId, { agent_id: agentId });

    // List tools after attach
    const agentAfter = await client.agents.retrieve(agentId);
    const toolsAfter = (agentAfter.tools ?? []).map((t) => t.name);
    console.log(`   Tools after attach: ${JSON.stringify(toolsAfter)}`);
    const newTools = toolsAfter.filter((t) => !toolsBefore.includes(t));
    console.log(`   New tools gained: ${JSON.stringify(newTools)}`);

    // List agent files
    const agentFiles = await client.agents.files.list(agentId, { limit: 50 });
    console.log(`   Agent file count: ${agentFiles.files.length}`);
    for (const f of agentFiles.files) {
      console.log(`   ${f.file_name} (open: ${f.is_open})`);
    }

    // 6. Test queries
    console.log("\n6. Testing retrieval...");
    const tests = [
      {
        q: "What is the ChunkingStrategy type? Show its definition.",
        expect: "ChunkingStrategy",
      },
      {
        q: "What does the shouldIncludeFile function do? Find it in the codebase.",
        expect: "filter",
      },
      {
        q: "What interface does AgentProvider define? List its methods.",
        expect: "provider",
      },
      {
        q: "What npm dependencies does this project have?",
        expect: "letta-client",
      },
    ];

    let passed = 0;
    for (const { q, expect } of tests) {
      console.log(`\n  Q: ${q}`);
      const resp = await client.agents.messages.create(agentId, {
        messages: [{ role: "user", content: q }],
      });

      let answer = "";
      for (const msg of resp.messages) {
        // SDK Message union doesn't have a shared discriminant — cast via unknown
        const m = msg as unknown as Record<string, unknown>;
        const type = m.message_type as string;

        switch (type) {
        case "tool_call_message": {
          const call = m.tool_call as Record<string, unknown> | undefined;
          const name = call?.name ?? "";
          const args = String(call?.arguments ?? "").slice(0, 120);
          console.log(`  [tool] ${name}(${args})`);
        
        break;
        }
        case "tool_return_message": {
          const ret = String(m.tool_return ?? "").slice(0, 200);
          console.log(`  [return] ${ret}`);
        
        break;
        }
        case "assistant_message": {
          answer = String(m.content ?? "");
          console.log(`  [answer] ${answer.slice(0, 400)}`);
        
        break;
        }
        // No default
        }
      }

      const found = answer.toLowerCase().includes(expect.toLowerCase());
      console.log(`  ${found ? "PASS" : "FAIL"} (expect: "${expect}")`);
      if (found) passed++;
    }

    console.log(`\n=== RESULTS: ${passed}/${tests.length} passed ===`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    // Cleanup
    if (agentId) {
      console.log(`\nCleaning up agent ${agentId}...`);
      try {
        await client.agents.delete(agentId);
        console.log("  Agent deleted.");
      } catch {
        console.error("  Failed to delete agent.");
      }
    }
    if (folderId) {
      console.log(`Cleaning up folder ${folderId}...`);
      try {
        await client.folders.delete(folderId);
        console.log("  Folder deleted.");
      } catch {
        console.error("  Failed to delete folder.");
      }
    }
  }
}

main();
