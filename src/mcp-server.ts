#!/usr/bin/env tsx
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Letta } from "@letta-ai/letta-client";
import type { AssistantMessage } from "@letta-ai/letta-client/resources/agents/messages.js";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import {
  ASK_DEFAULT_CACHE_TTL_MS,
  ASK_DEFAULT_FAST_TIMEOUT_MS,
  ASK_DEFAULT_TIMEOUT_MS,
  buildAskRoutePlan,
  type AskRoutingMode,
} from "./core/ask-routing.js";
import { InMemoryAnswerCache, toModelCacheKey } from "./shell/answer-cache.js";

// Accept LETTA_PASSWORD as alias for LETTA_API_KEY (Codex compat)
if (process.env["LETTA_PASSWORD"] && !process.env["LETTA_API_KEY"]) {
  process.env["LETTA_API_KEY"] = process.env["LETTA_PASSWORD"];
}

export function createClient(): Letta {
  return new Letta({
    baseURL: process.env["LETTA_BASE_URL"],
  });
}

const messageCache = new InMemoryAnswerCache(ASK_DEFAULT_CACHE_TTL_MS);

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

async function handleTool(fn: () => Promise<string>): Promise<ToolResult> {
  try {
    const text = await fn();
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return { content: [{ type: "text", text: errorMessage(err) }], isError: true };
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
}

async function withTimeout<T>(label: string, timeoutMs: number, fn: () => Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function extractAssistantText(resp: { messages: unknown[] }): string {
  for (const msg of resp.messages) {
    if (typeof msg === "object" && msg !== null && "message_type" in msg && msg.message_type === "assistant_message") {
      const text = (msg as AssistantMessage).content;
      return typeof text === "string" ? text : "";
    }
  }
  return "";
}

export function registerTools(server: McpServer, client: Letta): void {
  server.tool("letta_list_agents", "List all Letta agents", {}, () =>
    handleTool(async () => {
      const summary: Array<{ id: string; name: string; description?: string | null; model?: string | null }> = [];
      for await (const a of client.agents.list()) {
        summary.push({ id: a.id, name: a.name, description: a.description, model: a.model ?? null });
      }
      return JSON.stringify(summary, null, 2);
    }),
  );

  server.tool(
    "letta_get_agent",
    "Get full details for a Letta agent",
    { agent_id: z.string().describe("The agent ID") },
    ({ agent_id }) =>
      handleTool(async () => {
        const agent = await client.agents.retrieve(agent_id);
        return JSON.stringify(agent, null, 2);
      }),
  );

  server.tool(
    "letta_send_message",
    "Send a message to a Letta agent and get the response",
    {
      agent_id: z.string().describe("The agent ID"),
      content: z.string().describe("The message content"),
      override_model: z.string().optional().describe("Optional per-request model override"),
      routing: z.enum(["auto", "quality", "speed"]).optional().describe("Routing mode used when override_model is omitted"),
      timeout_ms: z.number().int().positive().optional().describe("Request timeout in milliseconds"),
      max_steps: z.number().int().positive().optional().describe("Maximum reasoning/tool steps for this request"),
      cache: z.boolean().optional().describe("Enable in-memory response cache (default true)"),
    },
    ({ agent_id, content, override_model, routing, timeout_ms, max_steps, cache }) =>
      handleTool(async () => {
        const fastModel = process.env["LETTA_FAST_MODEL"]?.trim() || undefined;
        const askTimeoutMs = timeout_ms ?? parsePositiveInt(process.env["LETTA_ASK_TIMEOUT_MS"], ASK_DEFAULT_TIMEOUT_MS);
        const fastAskTimeoutMs = parsePositiveInt(process.env["LETTA_FAST_ASK_TIMEOUT_MS"], ASK_DEFAULT_FAST_TIMEOUT_MS);
        const routingMode: AskRoutingMode = routing ?? "auto";
        const cacheEnabled = cache !== false;

        const attempts: Array<{ overrideModel?: string; timeoutMs: number }> = [];
        if (override_model) {
          attempts.push({ overrideModel: override_model, timeoutMs: askTimeoutMs });
        } else {
          const plan = buildAskRoutePlan({
            routing: routingMode,
            question: content,
            fastModel,
            askTimeoutMs,
            fastAskTimeoutMs,
          });
          attempts.push({ overrideModel: plan.primaryOverrideModel, timeoutMs: plan.primaryTimeoutMs });
          if (plan.enableFallback) {
            attempts.push({ overrideModel: plan.fallbackOverrideModel, timeoutMs: plan.fallbackTimeoutMs });
          }
        }

        if (cacheEnabled) {
          for (const attempt of attempts) {
            const cached = messageCache.get({
              agentId: agent_id,
              question: content,
              modelKey: toModelCacheKey(attempt.overrideModel),
              lastSyncCommit: null,
            });
            if (cached !== null) return cached;
          }
        }

        const runAttempt = async (attempt: { overrideModel?: string; timeoutMs: number }): Promise<string> => {
          const payload: {
            messages: Array<{ role: "user"; content: string }>;
            override_model?: string;
            max_steps?: number;
          } = {
            messages: [{ role: "user", content }],
          };
          if (attempt.overrideModel) payload.override_model = attempt.overrideModel;
          if (max_steps !== undefined) payload.max_steps = max_steps;

          const response = await withTimeout(
            `letta_send_message (${attempt.overrideModel ?? "agent-default"})`,
            attempt.timeoutMs,
            () => client.agents.messages.create(agent_id, payload),
          );
          return extractAssistantText(response as { messages: unknown[] });
        };

        let answer: string | null = null;
        let usedModel = attempts[0].overrideModel;
        let primaryError: unknown = null;

        try {
          answer = await runAttempt(attempts[0]);
        } catch (err) {
          primaryError = err;
        }

        const hasFallback = attempts.length > 1;
        const shouldFallback = hasFallback && (primaryError !== null || (answer ?? "").trim().length === 0);

        if (shouldFallback) {
          answer = await runAttempt(attempts[1]);
          usedModel = attempts[1].overrideModel;
        } else if (primaryError !== null) {
          throw primaryError;
        }

        const finalAnswer = answer ?? "";
        if (cacheEnabled && finalAnswer.trim().length > 0) {
          messageCache.set(
            {
              agentId: agent_id,
              question: content,
              modelKey: toModelCacheKey(usedModel),
              lastSyncCommit: null,
            },
            finalAnswer,
          );
        }

        return finalAnswer;
      }),
  );

  server.tool(
    "letta_get_core_memory",
    "Get all memory blocks for a Letta agent",
    { agent_id: z.string().describe("The agent ID") },
    ({ agent_id }) =>
      handleTool(async () => {
        const agent = await client.agents.retrieve(agent_id);
        const summary = (agent.blocks ?? []).map((b) => ({
          label: b.label,
          value: b.value,
          limit: b.limit,
        }));
        return JSON.stringify(summary, null, 2);
      }),
  );

  server.tool(
    "letta_search_archival",
    "Search archival memory (passages) for a Letta agent",
    {
      agent_id: z.string().describe("The agent ID"),
      query: z.string().describe("Search query"),
      top_k: z.number().optional().describe("Max results to return"),
    },
    ({ agent_id, query, top_k }) =>
      handleTool(async () => {
        const results = await client.agents.passages.search(agent_id, { query, top_k });
        return JSON.stringify(results, null, 2);
      }),
  );

  server.tool(
    "letta_insert_passage",
    "Insert a passage into an agent's archival memory",
    {
      agent_id: z.string().describe("The agent ID"),
      text: z.string().describe("The passage text to store"),
    },
    ({ agent_id, text }) =>
      handleTool(async () => {
        const result = await client.agents.passages.create(agent_id, { text });
        return JSON.stringify(result, null, 2);
      }),
  );

  server.tool(
    "letta_delete_passage",
    "Delete a passage from an agent's archival memory. To update a passage, delete it and insert a new one.",
    {
      agent_id: z.string().describe("The agent ID"),
      passage_id: z.string().describe("The passage ID to delete"),
    },
    ({ agent_id, passage_id }) =>
      handleTool(async () => {
        await client.agents.passages.delete(passage_id, { agent_id });
        return "Deleted";
      }),
  );

  server.tool(
    "letta_update_block",
    "Update a memory block for a Letta agent",
    {
      agent_id: z.string().describe("The agent ID"),
      label: z.string().describe("Block label (e.g. persona, human)"),
      value: z.string().describe("New block value"),
    },
    ({ agent_id, label, value }) =>
      handleTool(async () => {
        const block = await client.agents.blocks.update(label, { agent_id, value });
        return JSON.stringify(block, null, 2);
      }),
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  const server = new McpServer({ name: "letta-tools", version: "1.0.0" });
  const client = createClient();
  registerTools(server, client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`letta-tools MCP server error: ${errorMessage(err)}\n`);
    process.exit(1);
  });
}
