#!/usr/bin/env node
/* eslint-disable max-lines -- MCP tool registration requires many schema/description lines in one module for now. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Letta } from "@letta-ai/letta-client";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import type { AgentProvider, SendMessageOptions } from "./shell/provider.js";
import type { AdminPort, AgentSummary } from "./ports/admin.js";
import { LettaProvider } from "./shell/letta-provider.js";
import { LettaAdminAdapter } from "./shell/adapters/letta-admin-adapter.js";
import { VikingProvider } from "./shell/viking-provider.js";
import { VikingHttpClient } from "./shell/viking-http.js";
import { VikingAdminAdapter } from "./shell/adapters/viking-admin-adapter.js";
import { FilesystemBlockStorage } from "./shell/block-storage.js";
import { resolveOpenVikingBlocksDir } from "./shell/openviking-paths.js";
import type { VikingRuntimeOptions } from "./shell/viking-provider.js";

// Accept LETTA_PASSWORD as alias for LETTA_API_KEY (Codex compat)
// Stryker disable next-line ConditionalExpression,LogicalOperator,StringLiteral -- module-level env setup, untestable in unit tests
if (process.env["LETTA_PASSWORD"] && !process.env["LETTA_API_KEY"]) {
  process.env["LETTA_API_KEY"] = process.env["LETTA_PASSWORD"];
}

const ASK_DEFAULT_TIMEOUT_MS = 60_000;
const PROVIDERS = ["letta", "viking"] as const;

type ProviderName = (typeof PROVIDERS)[number];

interface ProviderRuntime {
  provider: AgentProvider;
  admin: AdminPort;
}

interface ProviderRegistry {
  providers: Partial<Record<ProviderName, ProviderRuntime>>;
  bootstrapErrors: Partial<Record<ProviderName, string>>;
}

interface NamespacedAgentSummary extends AgentSummary {
  provider: ProviderName;
  provider_agent_id: string;
}

interface ParsedNamespacedAgentId {
  provider: ProviderName;
  agentId: string;
}

export function createClient(): Letta {
  return new Letta({
    baseURL: process.env["LETTA_BASE_URL"],
  });
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

function parseProviderName(raw: string | undefined): ProviderName | undefined {
  if (raw === "letta" || raw === "viking") return raw;
  return undefined;
}

function toNamespacedAgentSummary(provider: ProviderName, agent: AgentSummary): NamespacedAgentSummary {
  return {
    ...agent,
    id: `${provider}:${agent.id}`,
    provider,
    provider_agent_id: agent.id,
  };
}

function buildLettaRuntime(): ProviderRuntime | undefined {
  if (!process.env["LETTA_API_KEY"]) return undefined;
  const client = createClient();
  return {
    provider: new LettaProvider(client),
    admin: new LettaAdminAdapter(client),
  };
}

function buildVikingRuntime(): ProviderRuntime | undefined {
  const openrouterApiKey = process.env["OPENROUTER_API_KEY"];
  if (!openrouterApiKey) return undefined;
  const vikingUrl = process.env["VIKING_URL"] ?? "http://localhost:1933";
  const vikingApiKey = process.env["VIKING_API_KEY"];
  const model = process.env["OPENROUTER_MODEL"] ?? "openai/gpt-4o-mini";
  const viking = new VikingHttpClient(vikingUrl, vikingApiKey);
  const blockStorage = new FilesystemBlockStorage(resolveOpenVikingBlocksDir());
  const vikingProvider = new VikingProvider(viking, openrouterApiKey, model, blockStorage, getVikingRuntimeOptionsFromEnv());
  return {
    provider: vikingProvider,
    admin: new VikingAdminAdapter(vikingProvider, viking),
  };
}

export function buildProviderRegistry(): ProviderRegistry {
  const providers: ProviderRegistry["providers"] = {};
  const bootstrapErrors: ProviderRegistry["bootstrapErrors"] = {};

  try {
    const runtime = buildLettaRuntime();
    if (runtime) providers.letta = runtime;
  } catch (error) {
    bootstrapErrors.letta = errorMessage(error);
  }

  try {
    const runtime = buildVikingRuntime();
    if (runtime) providers.viking = runtime;
  } catch (error) {
    bootstrapErrors.viking = errorMessage(error);
  }

  return { providers, bootstrapErrors };
}

function selectLegacyRuntime(registry: ProviderRegistry, preferredRaw: string | undefined): ProviderRuntime {
  const preferred = parseProviderName(preferredRaw);
  if (preferred) {
    const runtime = registry.providers[preferred];
    if (runtime) return runtime;
  }
  if (registry.providers.letta) return registry.providers.letta;
  if (registry.providers.viking) return registry.providers.viking;

  const bootstrapDetails = PROVIDERS
    .map((provider) => registry.bootstrapErrors[provider] ? `${provider}: ${registry.bootstrapErrors[provider]}` : null)
    .filter((value): value is string => value !== null);
  const suffix = bootstrapDetails.length > 0 ? `\nBootstrap errors:\n- ${bootstrapDetails.join("\n- ")}` : "";
  throw new Error(
    "No provider is configured. Set LETTA_API_KEY and/or OPENROUTER_API_KEY in the MCP server env." + suffix,
  );
}

export function parseNamespacedAgentId(raw: string): ParsedNamespacedAgentId {
  const separator = raw.indexOf(":");
  if (separator <= 0 || separator >= raw.length - 1) {
    throw new Error(`agent_id "${raw}" must be namespaced as "<provider>:<id>" (e.g. "letta:agent-123").`);
  }
  const provider = parseProviderName(raw.slice(0, separator));
  if (!provider) {
    throw new Error(`Unsupported provider prefix "${raw.slice(0, separator)}". Use "letta" or "viking".`);
  }
  return { provider, agentId: raw.slice(separator + 1) };
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parseModelCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function getVikingRuntimeOptionsFromEnv(): VikingRuntimeOptions {
  return {
    requestTimeoutMs: parsePositiveInt(process.env["OPENROUTER_REQUEST_TIMEOUT_MS"], 20_000),
    maxRetriesPerModel: parseNonNegativeInt(process.env["OPENROUTER_MAX_RETRIES_PER_MODEL"], 1),
    retryBaseDelayMs: parsePositiveInt(process.env["OPENROUTER_RETRY_BASE_DELAY_MS"], 600),
    fallbackModels: parseModelCsv(process.env["OPENROUTER_FALLBACK_MODELS"]),
  };
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
  server.registerTool("letta_list_agents", {
    description: "List all Letta agents",
    inputSchema: {},
  }, () =>
    handleTool(async () => {
      const agents = await admin.listAgents();
      return JSON.stringify(agents, null, 2);
    }),
  );

  server.registerTool(
    "letta_get_agent",
    {
      description: "Get full details for a Letta agent",
      inputSchema: { agent_id: z.string().describe("The agent ID") },
    },
    ({ agent_id }) =>
      handleTool(async () => {
        const agent = await admin.getAgent(agent_id);
        return JSON.stringify(agent, null, 2);
      }),
  );

  server.registerTool(
    "letta_send_message",
    {
      description: "Send a message to a Letta agent and get the response",
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
        const askTimeoutMs = timeout_ms ?? parsePositiveInt(process.env["LETTA_ASK_TIMEOUT_MS"], ASK_DEFAULT_TIMEOUT_MS);

        const options: SendMessageOptions = {};
        if (override_model) options.overrideModel = override_model;
        if (max_steps !== undefined) options.maxSteps = max_steps;

        return await withTimeout(
          `letta_send_message (${override_model ?? "agent-default"})`,
          askTimeoutMs,
          () => provider.sendMessage(agent_id, content, options),
        );
      }),
  );

  server.registerTool(
    "letta_get_core_memory",
    {
      description: "Get all memory blocks for a Letta agent",
      inputSchema: { agent_id: z.string().describe("The agent ID") },
    },
    ({ agent_id }) =>
      handleTool(async () => {
        const blocks = await admin.getCoreMemory(agent_id);
        return JSON.stringify(blocks, null, 2);
      }),
  );

  server.registerTool(
    "letta_search_archival",
    {
      description: "Search archival memory (passages) for a Letta agent",
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
    "letta_insert_passage",
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
    "letta_delete_passage",
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
    "letta_update_block",
    {
      description: "Update a memory block for a Letta agent",
      inputSchema: {
        agent_id: z.string().describe("The agent ID"),
        label: z.string().describe("Block label (e.g. persona, human)"),
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

export function registerUnifiedTools(server: McpServer, registry: ProviderRegistry): void {
  server.registerTool("agent_list", {
    description: "List agents from configured Letta and Viking providers",
    inputSchema: {},
  }, () =>
    handleTool(async () => {
      const agents: NamespacedAgentSummary[] = [];
      const errors: Array<{ provider: ProviderName; error: string }> = [];

      for (const provider of PROVIDERS) {
        const runtime = registry.providers[provider];
        if (!runtime) continue;
        try {
          const listed = await runtime.admin.listAgents();
          agents.push(...listed.map((agent) => toNamespacedAgentSummary(provider, agent)));
        } catch (error) {
          errors.push({ provider, error: errorMessage(error) });
        }
      }

      for (const provider of PROVIDERS) {
        const bootstrapError = registry.bootstrapErrors[provider];
        if (bootstrapError) errors.push({ provider, error: bootstrapError });
      }

      agents.sort((a, b) => a.id.localeCompare(b.id));
      const payload: {
        agents: NamespacedAgentSummary[];
        errors?: Array<{ provider: ProviderName; error: string }>;
      } = { agents };
      if (errors.length > 0) payload.errors = errors;
      return JSON.stringify(payload, null, 2);
    }),
  );

  server.registerTool(
    "agent_call",
    {
      description: "Send a message to a namespaced agent_id (letta:<id> or viking:<id>)",
      inputSchema: {
        agent_id: z.string().describe("Namespaced agent ID, e.g. letta:<id> or viking:<id>"),
        content: z.string().describe("The message content"),
        override_model: z.string().optional().describe("Optional per-request model override"),
        timeout_ms: z.number().int().positive().optional().describe("Request timeout in milliseconds"),
        max_steps: z.number().int().positive().optional().describe("Maximum reasoning/tool steps for this request"),
      },
    },
    ({ agent_id, content, override_model, timeout_ms, max_steps }) =>
      handleTool(async () => {
        const parsed = parseNamespacedAgentId(agent_id);
        const runtime = registry.providers[parsed.provider];
        if (!runtime) {
          throw new Error(`Provider "${parsed.provider}" is not configured in this MCP instance.`);
        }

        const askTimeoutMs = timeout_ms ?? parsePositiveInt(process.env["LETTA_ASK_TIMEOUT_MS"], ASK_DEFAULT_TIMEOUT_MS);
        const options: SendMessageOptions = {};
        if (override_model) options.overrideModel = override_model;
        if (max_steps !== undefined) options.maxSteps = max_steps;

        return await withTimeout(
          `agent_call ${parsed.provider} (${override_model ?? "agent-default"})`,
          askTimeoutMs,
          () => runtime.provider.sendMessage(parsed.agentId, content, options),
        );
      }),
  );
}

// Stryker restore StringLiteral,ObjectLiteral

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function main(): Promise<void> {
  const server = new McpServer({ name: "letta-tools", version: "1.0.0" });
  const registry = buildProviderRegistry();
  const legacyRuntime = selectLegacyRuntime(registry, process.env["PROVIDER_TYPE"]);

  registerTools(server, legacyRuntime.provider, legacyRuntime.admin);
  registerUnifiedTools(server, registry);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Stryker disable next-line ConditionalExpression,EqualityOperator -- entry-point guard is untestable in unit tests
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`letta-tools MCP server error: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
/* eslint-enable max-lines */
