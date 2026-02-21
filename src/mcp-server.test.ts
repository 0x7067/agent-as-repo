import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./mcp-server.js";

interface MockPassages {
  search: Mock;
  create: Mock;
  delete: Mock;
}

interface MockBlocks {
  update: Mock;
}

interface MockMessages {
  create: Mock;
}

interface MockAgents {
  list: Mock;
  retrieve: Mock;
  passages: MockPassages;
  blocks: MockBlocks;
  messages: MockMessages;
}

interface MockLettaClient {
  agents: MockAgents;
}

function makeAsyncIterable<T>(items: T[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const item of items) yield item;
    },
  };
}

function makeMockClient(): MockLettaClient {
  return {
    agents: {
      list: vi.fn().mockReturnValue(
        makeAsyncIterable([
          { id: "agent-1", name: "Alice", description: "Test agent", model: "openai/gpt-4.1" },
          { id: "agent-2", name: "Bob", description: null, model: "openai/gpt-4.1-mini" },
        ]),
      ),
      retrieve: vi.fn().mockResolvedValue({
        id: "agent-1",
        name: "Alice",
        model: "openai/gpt-4.1",
        blocks: [
          { label: "persona", value: "I am Alice.", limit: 5000 },
          { label: "human", value: "Unknown user.", limit: 5000 },
        ],
      }),
      passages: {
        search: vi.fn().mockResolvedValue({ count: 1, results: [{ id: "p-1", content: "found it", timestamp: "2026-01-01" }] }),
        create: vi.fn().mockResolvedValue([{ id: "p-new", text: "new passage" }]),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      blocks: {
        update: vi.fn().mockResolvedValue({ id: "block-1", label: "persona", value: "Updated.", limit: 5000 }),
      },
      messages: {
        create: vi.fn().mockResolvedValue({
          messages: [
            { message_type: "tool_call_message", id: "m1", tool_call: { name: "memory_search", arguments: "" } },
            { message_type: "assistant_message", id: "m2", content: "Hello from agent" },
          ],
        }),
      },
    },
  };
}

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

interface RegisteredToolEntry {
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult>;
}

function extractToolHandler(server: McpServer, toolName: string): ToolHandler {
  const registeredTools = (server as unknown as { _registeredTools: Record<string, RegisteredToolEntry> })._registeredTools;
  const tool = registeredTools[toolName];
  if (!tool) throw new Error(`Tool ${toolName} not registered`);
  return (args) => tool.handler(args, {});
}

describe("MCP Server tools", () => {
  let server: McpServer;
  let client: MockLettaClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "0.0.1" });
    client = makeMockClient();
    registerTools(server, client as unknown as Parameters<typeof registerTools>[1]);
  });

  it("registers all 8 tools", () => {
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools).length).toBe(8);
    expect(Object.keys(tools).sort()).toEqual([
      "letta_delete_passage",
      "letta_get_agent",
      "letta_get_core_memory",
      "letta_insert_passage",
      "letta_list_agents",
      "letta_search_archival",
      "letta_send_message",
      "letta_update_block",
    ]);
  });

  describe("letta_list_agents", () => {
    it("returns agent summaries", async () => {
      const handler = extractToolHandler(server, "letta_list_agents");
      const result = await handler({});
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveLength(2);
      expect(data[0]).toEqual({ id: "agent-1", name: "Alice", description: "Test agent", model: "openai/gpt-4.1" });
    });

    it("returns isError on failure", async () => {
      const failing = {
        [Symbol.asyncIterator]: async function* () {
          throw new Error("API down");
        },
        then: (_: unknown, reject: (e: unknown) => void) => reject(new Error("API down")),
      };
      client.agents.list.mockReturnValue(failing);
      const handler = extractToolHandler(server, "letta_list_agents");
      const result = await handler({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("API down");
    });
  });

  describe("letta_get_agent", () => {
    it("returns full agent details", async () => {
      const handler = extractToolHandler(server, "letta_get_agent");
      const result = await handler({ agent_id: "agent-1" });
      const data = JSON.parse(result.content[0].text);
      expect(data.id).toBe("agent-1");
      expect(data.name).toBe("Alice");
      expect(client.agents.retrieve).toHaveBeenCalledWith("agent-1");
    });

    it("returns isError on failure", async () => {
      client.agents.retrieve.mockRejectedValue(new Error("not found"));
      const handler = extractToolHandler(server, "letta_get_agent");
      const result = await handler({ agent_id: "bad-id" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("not found");
    });
  });

  describe("letta_send_message", () => {
    it("returns assistant message text", async () => {
      const handler = extractToolHandler(server, "letta_send_message");
      const result = await handler({ agent_id: "agent-1", content: "Hi" });
      expect(result.content[0].text).toBe("Hello from agent");
      expect(client.agents.messages.create).toHaveBeenCalledWith("agent-1", {
        messages: [{ role: "user", content: "Hi" }],
      });
    });

    it("returns empty string when no assistant message", async () => {
      client.agents.messages.create.mockResolvedValue({
        messages: [{ message_type: "tool_call_message", id: "m1", tool_call: { name: "t", arguments: "" } }],
      });
      const handler = extractToolHandler(server, "letta_send_message");
      const result = await handler({ agent_id: "agent-1", content: "Hi" });
      expect(result.content[0].text).toBe("");
    });

    it("returns isError on failure", async () => {
      client.agents.messages.create.mockRejectedValue(new Error("timeout"));
      const handler = extractToolHandler(server, "letta_send_message");
      const result = await handler({ agent_id: "agent-1", content: "Hi" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("timeout");
    });

    it("passes override_model and max_steps through to API", async () => {
      const handler = extractToolHandler(server, "letta_send_message");
      await handler({
        agent_id: "agent-1",
        content: "Hi",
        override_model: "openai/gpt-4.1-mini",
        max_steps: 3,
      });
      expect(client.agents.messages.create).toHaveBeenCalledWith("agent-1", {
        messages: [{ role: "user", content: "Hi" }],
        override_model: "openai/gpt-4.1-mini",
        max_steps: 3,
      });
    });
  });

  describe("letta_get_core_memory", () => {
    it("returns memory blocks", async () => {
      const handler = extractToolHandler(server, "letta_get_core_memory");
      const result = await handler({ agent_id: "agent-1" });
      const data = JSON.parse(result.content[0].text);
      expect(data).toEqual([
        { label: "persona", value: "I am Alice.", limit: 5000 },
        { label: "human", value: "Unknown user.", limit: 5000 },
      ]);
    });

    it("returns empty array when no memory blocks", async () => {
      client.agents.retrieve.mockResolvedValue({ id: "agent-1", name: "Alice", blocks: null });
      const handler = extractToolHandler(server, "letta_get_core_memory");
      const result = await handler({ agent_id: "agent-1" });
      expect(JSON.parse(result.content[0].text)).toEqual([]);
    });

    it("returns isError on failure", async () => {
      client.agents.retrieve.mockRejectedValue(new Error("agent gone"));
      const handler = extractToolHandler(server, "letta_get_core_memory");
      const result = await handler({ agent_id: "bad-id" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("agent gone");
    });
  });

  describe("letta_search_archival", () => {
    it("returns search results", async () => {
      const handler = extractToolHandler(server, "letta_search_archival");
      const result = await handler({ agent_id: "agent-1", query: "auth" });
      const data = JSON.parse(result.content[0].text);
      expect(data.count).toBe(1);
      expect(client.agents.passages.search).toHaveBeenCalledWith("agent-1", { query: "auth", top_k: undefined });
    });

    it("passes top_k when provided", async () => {
      const handler = extractToolHandler(server, "letta_search_archival");
      await handler({ agent_id: "agent-1", query: "auth", top_k: 5 });
      expect(client.agents.passages.search).toHaveBeenCalledWith("agent-1", { query: "auth", top_k: 5 });
    });

    it("returns isError on failure", async () => {
      client.agents.passages.search.mockRejectedValue(new Error("search failed"));
      const handler = extractToolHandler(server, "letta_search_archival");
      const result = await handler({ agent_id: "agent-1", query: "auth" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("search failed");
    });
  });

  describe("letta_insert_passage", () => {
    it("inserts and returns the passage", async () => {
      const handler = extractToolHandler(server, "letta_insert_passage");
      const result = await handler({ agent_id: "agent-1", text: "new passage" });
      const data = JSON.parse(result.content[0].text);
      expect(data[0].id).toBe("p-new");
      expect(client.agents.passages.create).toHaveBeenCalledWith("agent-1", { text: "new passage" });
    });

    it("returns isError on failure", async () => {
      client.agents.passages.create.mockRejectedValue(new Error("quota exceeded"));
      const handler = extractToolHandler(server, "letta_insert_passage");
      const result = await handler({ agent_id: "agent-1", text: "x" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("quota exceeded");
    });
  });

  describe("letta_delete_passage", () => {
    it("deletes a passage", async () => {
      const handler = extractToolHandler(server, "letta_delete_passage");
      const result = await handler({ agent_id: "agent-1", passage_id: "p-1" });
      expect(result.content[0].text).toBe("Deleted");
      expect(client.agents.passages.delete).toHaveBeenCalledWith("p-1", { agent_id: "agent-1" });
    });

    it("returns isError on failure", async () => {
      client.agents.passages.delete.mockRejectedValue(new Error("not found"));
      const handler = extractToolHandler(server, "letta_delete_passage");
      const result = await handler({ agent_id: "agent-1", passage_id: "p-x" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("not found");
    });
  });

  describe("letta_update_block", () => {
    it("updates and returns the block", async () => {
      const handler = extractToolHandler(server, "letta_update_block");
      const result = await handler({ agent_id: "agent-1", label: "persona", value: "Updated." });
      const data = JSON.parse(result.content[0].text);
      expect(data.label).toBe("persona");
      expect(data.value).toBe("Updated.");
      expect(client.agents.blocks.update).toHaveBeenCalledWith("persona", { agent_id: "agent-1", value: "Updated." });
    });

    it("returns isError on failure", async () => {
      client.agents.blocks.update.mockRejectedValue(new Error("not found"));
      const handler = extractToolHandler(server, "letta_update_block");
      const result = await handler({ agent_id: "agent-1", label: "persona", value: "x" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("not found");
    });
  });
});
