/**
 * Spike #7b: Folders API vs Archival Passages — side-by-side comparison
 *
 * Cloud API doesn't allow custom embedding_chunk_size, so we compare:
 *   A) Folders API (server-side chunking, grep/open/search tools)
 *   B) Archival passages with our manual 2KB chunker (archival_memory_search)
 *
 * Uses 10 source files (no tests) for a realistic corpus.
 * Same 5 questions sent to each. Prints a comparison table at the end.
 *
 * Run: pnpm tsx spikes/07b-folders-compare.ts
 */
import "dotenv/config";
import Letta from "@letta-ai/letta-client";
import { createReadStream } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { chunkFile } from "../src/core/chunker.js";

const client = new Letta();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

/** 10 source files — production code only, good spread of core/shell. */
const TEST_FILES = [
  "src/core/types.ts",
  "src/core/chunker.ts",
  "src/core/filter.ts",
  "src/core/sync.ts",
  "src/core/config.ts",
  "src/core/prompts.ts",
  "src/shell/provider.ts",
  "src/shell/letta-provider.ts",
  "src/shell/sync.ts",
  "src/shell/watch.ts",
  "package.json",
];

const QUESTIONS = [
  { q: "What is the ChunkingStrategy type? Show its full definition.", expect: "ChunkingStrategy" },
  { q: "What does shouldIncludeFile check? Describe each condition.", expect: "extension" },
  { q: "List all methods on the AgentProvider interface.", expect: "storePassage" },
  { q: "What are the production npm dependencies in package.json?", expect: "letta-client" },
  { q: "What is the FILE_PREFIX constant and where is it used?", expect: "FILE: " },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForProcessing(folderId: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 120_000) {
    const page = await client.folders.files.list(folderId, { limit: 50 });
    const pending = page.items.filter(
      (f) => f.processing_status !== "completed" && f.processing_status !== "error",
    );
    if (pending.length === 0) {
      for (const e of page.items.filter((f) => f.processing_status === "error")) {
        console.error(`  ERROR: ${e.file_name}: ${e.error_message}`);
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error("Processing timed out");
}

interface TestResult {
  question: string;
  expect: string;
  answer: string;
  passed: boolean;
  toolCalls: string[];
}

async function runQuestions(agentId: string): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (const { q, expect } of QUESTIONS) {
    process.stdout.write(`  Q: ${q.slice(0, 60)}... `);
    const resp = await client.agents.messages.create(agentId, {
      messages: [{ role: "user", content: q }],
    });

    let answer = "";
    const toolCalls: string[] = [];

    for (const msg of resp.messages) {
      const m = msg as unknown as Record<string, unknown>;
      const type = m.message_type as string;
      if (type === "tool_call_message") {
        const call = m.tool_call as Record<string, unknown> | undefined;
        toolCalls.push(String(call?.name ?? ""));
      } else if (type === "assistant_message") {
        answer = String(m.content ?? "");
      }
    }

    const passed = answer.toLowerCase().includes(expect.toLowerCase());
    console.log(passed ? "PASS" : "FAIL");

    results.push({ question: q, expect, answer, passed, toolCalls });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Variant setup
// ---------------------------------------------------------------------------

interface Variant {
  label: string;
  agentId: string;
  folderId?: string;
  results: TestResult[];
  chunkInfo: string;
}

async function setupFolderVariant(): Promise<Variant> {
  const folderName = `spike-compare-folders-${Date.now()}`;
  const folder = await client.folders.create({
    name: folderName,
    description: "Spike: Folders API comparison test",
  });

  for (const relPath of TEST_FILES) {
    const absPath = path.join(PROJECT_ROOT, relPath);
    await client.folders.files.upload(folder.id, {
      file: createReadStream(absPath),
      name: relPath,
      duplicate_handling: "replace",
    });
  }

  await waitForProcessing(folder.id);

  const page = await client.folders.files.list(folder.id, { limit: 50 });
  const totalChunks = page.items.reduce((sum, f) => sum + (f.total_chunks ?? 0), 0);
  const chunkInfo = page.items.map((f) => `${f.file_name}=${f.total_chunks}`).join(", ");

  const agent = await client.agents.create({
    name: `spike-compare-folders-${Date.now()}`,
    model: "openai/gpt-4.1",
    embedding: "openai/text-embedding-3-small",
    memory_blocks: [
      {
        label: "persona",
        value: [
          "I am a codebase expert for a TypeScript project called repo-expert.",
          "I have source files attached via folders.",
          "I use grep_files to search for patterns, then open_files to read code.",
          "I always search the files before answering.",
        ].join("\n"),
        limit: 5000,
      },
      { label: "human", value: "Developer asking about the codebase.", limit: 5000 },
    ],
    tags: ["spike-test"],
  });

  await client.agents.folders.attach(folder.id, { agent_id: agent.id });

  return {
    label: "folders",
    agentId: agent.id,
    folderId: folder.id,
    results: [],
    chunkInfo: `${totalChunks} chunks (${chunkInfo})`,
  };
}

async function setupArchivalVariant(): Promise<Variant> {
  const agent = await client.agents.create({
    name: `spike-compare-archival-${Date.now()}`,
    model: "openai/gpt-4.1",
    embedding: "openai/text-embedding-3-small",
    tools: ["archival_memory_search"],
    memory_blocks: [
      {
        label: "persona",
        value: [
          "I am a codebase expert for a TypeScript project called repo-expert.",
          "All project source files are stored in my archival memory.",
          "I always use archival_memory_search to find code before answering.",
          "When using archival_memory_search, only use the query parameter.",
        ].join("\n"),
        limit: 5000,
      },
      { label: "human", value: "Developer asking about the codebase.", limit: 5000 },
    ],
    tags: ["spike-test"],
  });

  let totalChunks = 0;
  const chunkParts: string[] = [];
  for (const relPath of TEST_FILES) {
    const absPath = path.join(PROJECT_ROOT, relPath);
    const content = await fs.readFile(absPath, "utf-8");
    const chunks = chunkFile(relPath, content);
    for (const chunk of chunks) {
      await client.agents.passages.create(agent.id, { text: chunk.text });
    }
    totalChunks += chunks.length;
    chunkParts.push(`${relPath}=${chunks.length}`);
  }

  return {
    label: "archival",
    agentId: agent.id,
    results: [],
    chunkInfo: `${totalChunks} chunks (${chunkParts.join(", ")})`,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const variants: Variant[] = [];

  try {
    console.log("Setting up variants...\n");

    console.log("  [A] Folders API (server-side chunking)...");
    const varA = await setupFolderVariant();
    variants.push(varA);
    console.log(`      ${varA.chunkInfo}\n`);

    console.log("  [B] Archival passages (our 2KB chunker)...");
    const varB = await setupArchivalVariant();
    variants.push(varB);
    console.log(`      ${varB.chunkInfo}\n`);

    // Run questions
    for (const v of variants) {
      console.log(`\nRunning questions on [${v.label}]...`);
      v.results = await runQuestions(v.agentId);
    }

    // -----------------------------------------------------------------------
    // Comparison table
    // -----------------------------------------------------------------------
    console.log("\n" + "=".repeat(90));
    console.log("COMPARISON TABLE");
    console.log("=".repeat(90));

    const col1 = 52;
    const col2 = 19;

    console.log(
      `\n${"Question".padEnd(col1)}${"folders".padEnd(col2)}${"archival".padEnd(col2)}`,
    );
    console.log("-".repeat(col1 + col2 * 2));

    for (let i = 0; i < QUESTIONS.length; i++) {
      const qShort = QUESTIONS[i].q.slice(0, col1 - 2).padEnd(col1);
      const cells = variants.map((v) => {
        const r = v.results[i];
        const mark = r.passed ? "PASS" : "FAIL";
        const tools = r.toolCalls.length > 0 ? ` (${r.toolCalls.length} calls)` : "";
        return `${mark}${tools}`.padEnd(col2);
      });
      console.log(`${qShort}${cells.join("")}`);
    }

    console.log("-".repeat(col1 + col2 * 2));
    const totals = variants.map(
      (v) => `${v.results.filter((r) => r.passed).length}/${QUESTIONS.length}`.padEnd(col2),
    );
    console.log(`${"TOTAL".padEnd(col1)}${totals.join("")}`);

    // Chunk stats
    console.log("\nChunk counts:");
    for (const v of variants) {
      console.log(`  [${v.label}] ${v.chunkInfo}`);
    }

    // Tool usage comparison
    console.log("\nTool usage:");
    for (const v of variants) {
      const allTools = v.results.flatMap((r) => r.toolCalls);
      const counts: Record<string, number> = {};
      for (const t of allTools) counts[t] = (counts[t] ?? 0) + 1;
      console.log(`  [${v.label}] ${JSON.stringify(counts)}`);
    }

    // Failed answer details
    const failures = variants.flatMap((v) =>
      v.results.filter((r) => !r.passed).map((r) => ({ label: v.label, ...r })),
    );
    if (failures.length > 0) {
      console.log("\nFailed answer details:");
      for (const f of failures) {
        console.log(`\n  [${f.label}] Q: ${f.question}`);
        console.log(`  Expected: "${f.expect}"`);
        console.log(`  Tools: ${f.toolCalls.join(" → ")}`);
        console.log(`  Answer: ${f.answer.slice(0, 300)}`);
      }
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    console.log("\nCleaning up...");
    for (const v of variants) {
      try { await client.agents.delete(v.agentId); } catch {}
      if (v.folderId) {
        try { await client.folders.delete(v.folderId); } catch {}
      }
    }
    console.log("Done.");
  }
}

main();
