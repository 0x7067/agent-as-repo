import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./mcp-server.js";
import type { AgentProvider } from "./shell/provider.js";
import type { AdminPort } from "./ports/admin.js";

function makeMockProvider(): AgentProvider {
  return {
    createAgent: vi.fn(),
    deleteAgent: vi.fn(),
    enableSleeptime: vi.fn(),
    storePassage: vi.fn<[], Promise<string>>().mockResolvedValue("p-new"),
    deletePassage: vi.fn<[], Promise<void>>().mockResolvedValue(),
    listPassages: vi.fn().mockResolvedValue([]),
    getBlock: vi.fn().mockResolvedValue({ value: "block value", limit: 5000 }),
    updateBlock: vi.fn().mockResolvedValue({ value: "Updated.", limit: 5000 }),
    sendMessage: vi.fn<[], Promise<string>>().mockResolvedValue("Hello from agent"),
  };
}

function makeMockAdmin(): AdminPort {
  return {
    listAgents: vi.fn().mockResolvedValue([
      { id: "agent-1", name: "Alice", description: "Test agent", model: "openai/gpt-4.1" },
      { id: "agent-2", name: "Bob", description: null, model: "openai/gpt-4.1-mini" },
    ]),
    getAgent: vi.fn().mockResolvedValue({
      id: "agent-1",
      name: "Alice",
      model: "openai/gpt-4.1",
      blocks: [
        { label: "persona", value: "I am Alice.", limit: 5000 },
        { label: "human", value: "Unknown user.", limit: 5000 },
      ],
    }),
    getCoreMemory: vi.fn().mockResolvedValue([
      { label: "persona", value: "I am Alice.", limit: 5000 },
      { label: "human", value: "Unknown user.", limit: 5000 },
    ]),
    searchPassages: vi.fn().mockResolvedValue([
      { id: "p-1", text: "found it" },
    ]),
  };
}

interface ToolResult { content: Array<{ type: string; text: string }>; isError?: boolean }
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
  let provider: AgentProvider;
  let admin: AdminPort;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "0.0.1" });
    provider = makeMockProvider();
    admin = makeMockAdmin();
    registerTools(server, provider, admin);
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
      (admin.listAgents as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("API down"));
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
      expect(admin.getAgent).toHaveBeenCalledWith("agent-1");
    });

    it("returns isError on failure", async () => {
      (admin.getAgent as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));
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
      expect(provider.sendMessage).toHaveBeenCalledWith("agent-1", "Hi", {});
    });

    it("returns empty string when provider returns empty", async () => {
      (provider.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue("");
      const handler = extractToolHandler(server, "letta_send_message");
      const result = await handler({ agent_id: "agent-1", content: "Hi" });
      expect(result.content[0].text).toBe("");
    });

    it("returns isError on failure", async () => {
      (provider.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("timeout"));
      const handler = extractToolHandler(server, "letta_send_message");
      const result = await handler({ agent_id: "agent-1", content: "Hi" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("timeout");
    });

    it("passes overrideModel and maxSteps through to provider", async () => {
      const handler = extractToolHandler(server, "letta_send_message");
      await handler({
        agent_id: "agent-1",
        content: "Hi",
        override_model: "openai/gpt-4.1-mini",
        max_steps: 3,
      });
      expect(provider.sendMessage).toHaveBeenCalledWith("agent-1", "Hi", {
        overrideModel: "openai/gpt-4.1-mini",
        maxSteps: 3,
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
      (admin.getCoreMemory as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const handler = extractToolHandler(server, "letta_get_core_memory");
      const result = await handler({ agent_id: "agent-1" });
      expect(JSON.parse(result.content[0].text)).toEqual([]);
    });

    it("returns isError on failure", async () => {
      (admin.getCoreMemory as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("agent gone"));
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
      expect(data).toEqual([{ id: "p-1", text: "found it" }]);
      expect(admin.searchPassages).toHaveBeenCalledWith("agent-1", "auth", undefined);
    });

    it("passes top_k when provided", async () => {
      const handler = extractToolHandler(server, "letta_search_archival");
      await handler({ agent_id: "agent-1", query: "auth", top_k: 5 });
      expect(admin.searchPassages).toHaveBeenCalledWith("agent-1", "auth", 5);
    });

    it("returns isError on failure", async () => {
      (admin.searchPassages as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("search failed"));
      const handler = extractToolHandler(server, "letta_search_archival");
      const result = await handler({ agent_id: "agent-1", query: "auth" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("search failed");
    });
  });

  describe("letta_insert_passage", () => {
    it("inserts and returns the passage id", async () => {
      const handler = extractToolHandler(server, "letta_insert_passage");
      const result = await handler({ agent_id: "agent-1", text: "new passage" });
      const data = JSON.parse(result.content[0].text);
      expect(data.id).toBe("p-new");
      expect(provider.storePassage).toHaveBeenCalledWith("agent-1", "new passage");
    });

    it("returns isError on failure", async () => {
      (provider.storePassage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("quota exceeded"));
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
      expect(provider.deletePassage).toHaveBeenCalledWith("agent-1", "p-1");
    });

    it("returns isError on failure", async () => {
      (provider.deletePassage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));
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
      expect(data.value).toBe("Updated.");
      expect(data.limit).toBe(5000);
      expect(provider.updateBlock).toHaveBeenCalledWith("agent-1", "persona", "Updated.");
    });

    it("returns isError on failure", async () => {
      (provider.updateBlock as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));
      const handler = extractToolHandler(server, "letta_update_block");
      const result = await handler({ agent_id: "agent-1", label: "persona", value: "x" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("not found");
    });
  });
});
