#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import type { AgentProvider, SendMessageOptions } from "./ports/agent-provider.js";
import type { AdminPort } from "./ports/admin.js";
import { VikingProvider, type VikingRuntimeOptions } from "./shell/viking-provider.js";
import { VikingHttpClient } from "./shell/viking-http.js";
import { VikingPassageStore } from "./shell/adapters/viking-passage-store.js";
import { VikingAdminAdapter } from "./shell/adapters/viking-admin-adapter.js";
import { FilesystemBlockStorage } from "./shell/block-storage.js";
import { resolveOpenVikingBlocksDir } from "./shell/openviking-paths.js";

const ASK_DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_LLM_MODEL = "qwen3-coder:30b";
const DEFAULT_LLM_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_VIKING_URL = "http://localhost:1933";

export interface Runtime {
  provider: AgentProvider;
  admin: AdminPort;
}

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

async function handleTool(fn: () => Promise<string>): Promise<ToolResult> {
  try {
    const text = await fn();
    return { content: [{ type: "text", text }] };
  } catch (error) {
    return { content: [{ type: "text", text: errorMessage(error) }], isError: true };
  }
}

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  // Stryker disable next-line ConditionalExpression -- equivalent: NaN check below catches same falsy inputs
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function parseModelCsv(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function getVikingRuntimeOptionsFromEnv(): VikingRuntimeOptions {
  return {
    requestTimeoutMs: parsePositiveInt(process.env["LLM_REQUEST_TIMEOUT_MS"], 20_000),
    maxRetriesPerModel: parseNonNegativeInt(process.env["LLM_MAX_RETRIES_PER_MODEL"], 1),
    retryBaseDelayMs: parsePositiveInt(process.env["LLM_RETRY_BASE_DELAY_MS"], 600),
    fallbackModels: parseModelCsv(process.env["LLM_FALLBACK_MODELS"]),
  };
}

export function buildRuntime(): Runtime {
  const vikingUrl = process.env["VIKING_URL"] ?? DEFAULT_VIKING_URL;
  const vikingApiKey = process.env["VIKING_API_KEY"];
  const model = process.env["LLM_MODEL"] ?? DEFAULT_LLM_MODEL;
  const baseUrl = process.env["LLM_BASE_URL"] ?? DEFAULT_LLM_BASE_URL;
  const apiKey = process.env["LLM_API_KEY"];
  const viking = new VikingHttpClient(vikingUrl, vikingApiKey);
  const store = new VikingPassageStore(viking);
  const blockStorage = new FilesystemBlockStorage(resolveOpenVikingBlocksDir());
  const provider = new VikingProvider(store, model, blockStorage, {
    baseUrl,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...getVikingRuntimeOptionsFromEnv(),
  });
  return { provider, admin: new VikingAdminAdapter(provider, store) };
}

export async function withTimeout<T>(label: string, timeoutMs: number, fn: () => Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => { reject(new Error(`${label} timed out after ${String(timeoutMs)}ms`)); }, timeoutMs);
      }),
    ]);
  } finally {
    // Stryker disable next-line ConditionalExpression,EqualityOperator -- timeoutId is always set by Promise executor; if (true) is equivalent
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

// Stryker disable StringLiteral,ObjectLiteral -- tool descriptions and schema shapes are not testable via unit tests (handlers are called directly, bypassing MCP input validation)
export function registerTools(server: McpServer, provider: AgentProvider, admin: AdminPort): void {
  server.registerTool("agent_list", {
    description: "List all repo-expert agents",
    inputSchema: {},
  }, () =>
    handleTool(async () => {
      const agents = await admin.listAgents();
      return JSON.stringify(agents, null, 2);
    }),
  );

  server.registerTool(
    "agent_get",
    {
      description: "Get full details for an agent",
      inputSchema: { agent_id: z.string().describe("The agent ID") },
    },
    ({ agent_id }) =>
      handleTool(async () => {
        const agent = await admin.getAgent(agent_id);
        return JSON.stringify(agent, null, 2);
      }),
  );

  server.registerTool(
    "agent_call",
    {
      description: "Send a message to an agent and get the response",
      inputSchema: {
        agent_id: z.string().describe("The agent ID"),
        content: z.string().describe("The message content"),
        override_model: z.string().optional().describe("Optional per-request model override"),
        timeout_ms: z.number().int().positive().optional().describe("Request timeout in milliseconds"),
        max_steps: z.number().int().positive().optional().describe("Maximum reasoning/tool steps for this request"),
      },
    },
    ({ agent_id, content, override_model, timeout_ms, max_steps }) =>
      handleTool(async () => {
        const askTimeoutMs = timeout_ms ?? parsePositiveInt(process.env["REPO_EXPERT_ASK_TIMEOUT_MS"], ASK_DEFAULT_TIMEOUT_MS);

        const options: SendMessageOptions = {};
        if (override_model) options.overrideModel = override_model;
        if (max_steps !== undefined) options.maxSteps = max_steps;

        return await withTimeout(
          `agent_call (${override_model ?? "agent-default"})`,
          askTimeoutMs,
          () => provider.sendMessage(agent_id, content, options),
        );
      }),
  );

  server.registerTool(
    "agent_get_core_memory",
    {
      description: "Get all memory blocks for an agent",
      inputSchema: { agent_id: z.string().describe("The agent ID") },
    },
    ({ agent_id }) =>
      handleTool(async () => {
        const blocks = await admin.getCoreMemory(agent_id);
        return JSON.stringify(blocks, null, 2);
      }),
  );

  server.registerTool(
    "agent_search_archival",
    {
      description: "Search archival memory (passages) for an agent",
      inputSchema: {
        agent_id: z.string().describe("The agent ID"),
        query: z.string().describe("Search query"),
        top_k: z.number().optional().describe("Max results to return"),
      },
    },
    ({ agent_id, query, top_k }) =>
      handleTool(async () => {
        const results = await admin.searchPassages(agent_id, query, top_k);
        return JSON.stringify(results, null, 2);
      }),
  );

  server.registerTool(
    "agent_insert_passage",
    {
      description: "Insert a passage into an agent's archival memory",
      inputSchema: {
        agent_id: z.string().describe("The agent ID"),
        text: z.string().describe("The passage text to store"),
      },
    },
    ({ agent_id, text }) =>
      handleTool(async () => {
        const id = await provider.storePassage(agent_id, text);
        return JSON.stringify({ id }, null, 2);
      }),
  );

  server.registerTool(
    "agent_delete_passage",
    {
      description: "Delete a passage from an agent's archival memory. To update a passage, delete it and insert a new one.",
      inputSchema: {
        agent_id: z.string().describe("The agent ID"),
        passage_id: z.string().describe("The passage ID to delete"),
      },
    },
    ({ agent_id, passage_id }) =>
      handleTool(async () => {
        await provider.deletePassage(agent_id, passage_id);
        return "Deleted";
      }),
  );

  server.registerTool(
    "agent_update_block",
    {
      description: "Update a memory block for an agent",
      inputSchema: {
        agent_id: z.string().describe("The agent ID"),
        label: z.string().describe("Block label (e.g. persona, architecture, conventions)"),
        value: z.string().describe("New block value"),
      },
    },
    ({ agent_id, label, value }) =>
      handleTool(async () => {
        const block = await provider.updateBlock(agent_id, label, value);
        return JSON.stringify(block, null, 2);
      }),
  );
}
// Stryker restore StringLiteral,ObjectLiteral

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function main(): Promise<void> {
  const server = new McpServer({ name: "repo-expert-mcp", version: "1.0.0" });
  const runtime = buildRuntime();
  registerTools(server, runtime.provider, runtime.admin);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Stryker disable BlockStatement,ConditionalExpression,EqualityOperator,StringLiteral -- entry-point guard is untestable in unit tests
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`repo-expert MCP server error: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
// Stryker restore BlockStatement,ConditionalExpression,EqualityOperator,StringLiteral
