#!/usr/bin/env tsx
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Letta } from "@letta-ai/letta-client";
import type { AssistantMessage } from "@letta-ai/letta-client/resources/agents/messages.js";
import { z } from "zod/v4";

// Accept LETTA_PASSWORD as alias for LETTA_API_KEY (Codex compat)
if (process.env["LETTA_PASSWORD"] && !process.env["LETTA_API_KEY"]) {
  process.env["LETTA_API_KEY"] = process.env["LETTA_PASSWORD"];
}

export function createClient(): Letta {
  return new Letta({
    baseURL: process.env["LETTA_BASE_URL"],
  });
}

export function registerTools(server: McpServer, client: Letta): void {
  server.tool("letta_list_agents", "List all Letta agents", {}, async () => {
    try {
      const summary: Array<{ id: string; name: string; description?: string | null; model?: string | null }> = [];
      for await (const a of client.agents.list()) {
        summary.push({ id: a.id, name: a.name, description: a.description, model: a.model ?? null });
      }
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: errorMessage(err) }], isError: true };
    }
  });

  server.tool(
    "letta_get_agent",
    "Get full details for a Letta agent",
    { agent_id: z.string().describe("The agent ID") },
    async ({ agent_id }) => {
      try {
        const agent = await client.agents.retrieve(agent_id);
        return { content: [{ type: "text", text: JSON.stringify(agent, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: errorMessage(err) }], isError: true };
      }
    },
  );

  server.tool(
    "letta_send_message",
    "Send a message to a Letta agent and get the response",
    {
      agent_id: z.string().describe("The agent ID"),
      content: z.string().describe("The message content"),
    },
    async ({ agent_id, content }) => {
      try {
        const resp = await client.agents.messages.create(agent_id, {
          messages: [{ role: "user", content }],
        });
        for (const msg of resp.messages) {
          if (msg.message_type === "assistant_message") {
            const text = (msg as AssistantMessage).content;
            return { content: [{ type: "text", text: typeof text === "string" ? text : "" }] };
          }
        }
        return { content: [{ type: "text", text: "" }] };
      } catch (err) {
        return { content: [{ type: "text", text: errorMessage(err) }], isError: true };
      }
    },
  );

  server.tool(
    "letta_get_core_memory",
    "Get all memory blocks for a Letta agent",
    { agent_id: z.string().describe("The agent ID") },
    async ({ agent_id }) => {
      try {
        const agent = await client.agents.retrieve(agent_id);
        const summary = (agent.blocks ?? []).map((b) => ({
          label: b.label,
          value: b.value,
          limit: b.limit,
        }));
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: errorMessage(err) }], isError: true };
      }
    },
  );

  server.tool(
    "letta_search_archival",
    "Search archival memory (passages) for a Letta agent",
    {
      agent_id: z.string().describe("The agent ID"),
      query: z.string().describe("Search query"),
      top_k: z.number().optional().describe("Max results to return"),
    },
    async (args) => {
      const { agent_id, query, top_k } = args as { agent_id: string; query: string; top_k?: number };
      try {
        const results = await client.agents.passages.search(agent_id, { query, top_k });
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: errorMessage(err) }], isError: true };
      }
    },
  );

  server.tool(
    "letta_insert_passage",
    "Insert a passage into an agent's archival memory",
    {
      agent_id: z.string().describe("The agent ID"),
      text: z.string().describe("The passage text to store"),
    },
    async ({ agent_id, text }) => {
      try {
        const result = await client.agents.passages.create(agent_id, { text });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: errorMessage(err) }], isError: true };
      }
    },
  );

  server.tool(
    "letta_delete_passage",
    "Delete a passage from an agent's archival memory. To update a passage, delete it and insert a new one.",
    {
      agent_id: z.string().describe("The agent ID"),
      passage_id: z.string().describe("The passage ID to delete"),
    },
    async ({ agent_id, passage_id }) => {
      try {
        await client.agents.passages.delete(passage_id, { agent_id });
        return { content: [{ type: "text", text: "Deleted" }] };
      } catch (err) {
        return { content: [{ type: "text", text: errorMessage(err) }], isError: true };
      }
    },
  );

  server.tool(
    "letta_update_block",
    "Update a memory block for a Letta agent",
    {
      agent_id: z.string().describe("The agent ID"),
      label: z.string().describe("Block label (e.g. persona, human)"),
      value: z.string().describe("New block value"),
    },
    async ({ agent_id, label, value }) => {
      try {
        const block = await client.agents.blocks.update(label, {
          agent_id,
          value,
        });
        return { content: [{ type: "text", text: JSON.stringify(block, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: errorMessage(err) }], isError: true };
      }
    },
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

main().catch((err) => {
  process.stderr.write(`letta-tools MCP server error: ${errorMessage(err)}\n`);
  process.exit(1);
});
