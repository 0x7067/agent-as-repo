#!/usr/bin/env node
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import type { AgentProvider, SendMessageOptions } from "./ports/agent-provider.js";
import type { AdminPort } from "./ports/admin.js";
import type { Config } from "./core/types.js";
import { MEMORY_BLOCK_LIMIT } from "./core/types.js";
import { LocalProvider, type LocalRuntimeOptions } from "./shell/local-provider.js";
import { AdminAdapter } from "./shell/adapters/admin-adapter.js";
import { SqlitePassageStore } from "./shell/sqlite-store.js";
import { SqliteBlockStorage } from "./shell/sqlite-block-storage.js";
import { resolveStoreDbPath } from "./shell/repo-expert-paths.js";
import { createEmbedder, parseEmbeddingEngine } from "./shell/embedder-factory.js";
import { withTimeoutSignal } from "./shell/with-timeout.js";
import { readPackageVersion } from "./shell/package-version.js";
import { isMainModule } from "./shell/is-main-module.js";
import { loadConfig } from "./shell/config-loader.js";
import { createRepoAccess } from "./shell/repo-tools.js";

const ASK_DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_LLM_MODEL = "qwen3-coder:30b";
const DEFAULT_LLM_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";

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

export function getRuntimeOptionsFromEnv(): LocalRuntimeOptions {
  return {
    requestTimeoutMs: parsePositiveInt(process.env["LLM_REQUEST_TIMEOUT_MS"], 20_000),
    maxRetriesPerModel: parseNonNegativeInt(process.env["LLM_MAX_RETRIES_PER_MODEL"], 1),
    retryBaseDelayMs: parsePositiveInt(process.env["LLM_RETRY_BASE_DELAY_MS"], 600),
    fallbackModels: parseModelCsv(process.env["LLM_FALLBACK_MODELS"]),
  };
}

/** Load config.yaml for repo paths when present; agentic tools degrade gracefully if missing. */
export async function loadOptionalReposConfig(): Promise<Config | null> {
  const configPath = process.env["REPO_EXPERT_CONFIG"]
    ? path.resolve(process.env["REPO_EXPERT_CONFIG"])
    : path.resolve("config.yaml");
  try {
    return await loadConfig(configPath);
  } catch {
    return null;
  }
}

export async function buildRuntime(): Promise<Runtime> {
  const model = process.env["LLM_MODEL"] ?? DEFAULT_LLM_MODEL;
  const baseUrl = process.env["LLM_BASE_URL"] ?? DEFAULT_LLM_BASE_URL;
  const embeddingModel = process.env["LLM_EMBEDDING_MODEL"] ?? DEFAULT_EMBEDDING_MODEL;
  const embeddingEngine = parseEmbeddingEngine(process.env["LLM_EMBEDDING_ENGINE"]);
  const apiKey = process.env["LLM_API_KEY"];
  const dbPath = resolveStoreDbPath();
  const store = new SqlitePassageStore({
    dbPath,
    embed: createEmbedder({
      engine: embeddingEngine,
      model: embeddingModel,
      baseUrl,
      ...(apiKey === undefined ? {} : { apiKey }),
    }),
  });
  const blockStorage = new SqliteBlockStorage(dbPath);
  const config = await loadOptionalReposConfig();
  const provider = new LocalProvider(store, model, blockStorage, {
    baseUrl,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...getRuntimeOptionsFromEnv(),
    ...(config === null ? {} : { repoAccess: createRepoAccess(config.repos) }),
  });
  return { provider, admin: new AdminAdapter(provider, store) };
}

/** Look up an agent by ID against the admin registry (agent_list's source of truth). */
async function assertAgentExists(admin: AdminPort, agentId: string): Promise<void> {
  const agents = await admin.listAgents();
  if (!agents.some((agent) => agent.id === agentId)) {
    throw new Error(`agent not found: ${agentId}`);
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
        await assertAgentExists(admin, agent_id);
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
        await assertAgentExists(admin, agent_id);
        const askTimeoutMs = timeout_ms ?? parsePositiveInt(process.env["REPO_EXPERT_ASK_TIMEOUT_MS"], ASK_DEFAULT_TIMEOUT_MS);

        const options: SendMessageOptions = {};
        if (override_model) options.overrideModel = override_model;
        if (max_steps !== undefined) options.maxSteps = max_steps;

        return await withTimeoutSignal(
          `agent_call (${override_model ?? "agent-default"})`,
          askTimeoutMs,
          (signal) => provider.sendMessage(agent_id, content, { ...options, signal }),
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
        await assertAgentExists(admin, agent_id);
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
        top_k: z.number().int().positive().optional().describe("Max results to return"),
      },
    },
    ({ agent_id, query, top_k }) =>
      handleTool(async () => {
        await assertAgentExists(admin, agent_id);
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
        await assertAgentExists(admin, agent_id);
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
        await assertAgentExists(admin, agent_id);
        // The provider/store don't report affected rows for a delete, so the
        // only honest way to distinguish "deleted" from "nothing to delete"
        // from this file is to check existence first.
        const passages = await provider.listPassages(agent_id);
        if (!passages.some((passage) => passage.id === passage_id)) {
          throw new Error(`passage not found: ${passage_id}`);
        }
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
        await assertAgentExists(admin, agent_id);
        if (label === "persona") {
          throw new Error("Cannot update the persona block via agent_update_block; it is managed internally.");
        }
        if (value.length > MEMORY_BLOCK_LIMIT) {
          throw new Error(
            `Value for '${label}' is ${String(value.length)} chars, over the ${String(MEMORY_BLOCK_LIMIT)}-char limit.`,
          );
        }
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
  const server = new McpServer({ name: "repo-expert-mcp", version: readPackageVersion() });
  const runtime = await buildRuntime();
  registerTools(server, runtime.provider, runtime.admin);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Stryker disable BlockStatement,ConditionalExpression,EqualityOperator,StringLiteral -- entry-point guard is untestable in unit tests
if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`repo-expert MCP server error: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
// Stryker restore BlockStatement,ConditionalExpression,EqualityOperator,StringLiteral
