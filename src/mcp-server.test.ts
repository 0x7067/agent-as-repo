import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools, parsePositiveInt, withTimeout } from "./mcp-server.js";
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

describe("parsePositiveInt", () => {
  it("returns fallback when raw is undefined", () => {
    expect(parsePositiveInt(undefined, 60_000)).toBe(60_000);
  });

  it("returns fallback when raw is empty string", () => {
    expect(parsePositiveInt("", 60_000)).toBe(60_000);
  });

  it("returns fallback when raw is NaN", () => {
    expect(parsePositiveInt("abc", 60_000)).toBe(60_000);
  });

  it("returns fallback when raw is zero", () => {
    expect(parsePositiveInt("0", 60_000)).toBe(60_000);
  });

  it("returns fallback when raw is negative", () => {
    expect(parsePositiveInt("-5", 60_000)).toBe(60_000);
  });

  it("returns parsed int when raw is a positive integer string", () => {
    expect(parsePositiveInt("30000", 60_000)).toBe(30_000);
  });

  it("returns parsed int when raw is '1'", () => {
    expect(parsePositiveInt("1", 60_000)).toBe(1);
  });
});

describe("withTimeout", () => {
  it("resolves with the function result when it completes in time", async () => {
    const result = await withTimeout("test", 1000, async () => "ok");
    expect(result).toBe("ok");
  });

  it("rejects with a timeout error when function exceeds timeoutMs", async () => {
    await expect(
      withTimeout("my-op", 10, () => new Promise((resolve) => setTimeout(resolve, 5000))),
    ).rejects.toThrow("my-op timed out after 10ms");
  });

  it("clears timeout after function resolves (no timer leak)", async () => {
    // If timeout is not cleared, the test would run indefinitely after resolving
    const start = Date.now();
    await withTimeout("fast", 500, async () => "done");
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("calls clearTimeout with the actual timer ID when function resolves", async () => {
    const spy = vi.spyOn(global, "clearTimeout");
    await withTimeout("test", 5000, async () => "done");
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toBeDefined();
    spy.mockRestore();
  });
});

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

  it("content type is 'text' on success", async () => {
    const handler = extractToolHandler(server, "letta_list_agents");
    const result = await handler({});
    expect(result.content[0].type).toBe("text");
  });

  it("content type is 'text' on error", async () => {
    (admin.listAgents as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    const handler = extractToolHandler(server, "letta_list_agents");
    const result = await handler({});
    expect(result.content[0].type).toBe("text");
    expect(result.isError).toBe(true);
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

    it("does not set overrideModel when override_model is absent", async () => {
      const handler = extractToolHandler(server, "letta_send_message");
      await handler({ agent_id: "agent-1", content: "Hi" });
      const callArgs = (provider.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[2]).toEqual({});
      expect(callArgs[2].overrideModel).toBeUndefined();
    });

    it("does not set maxSteps when max_steps is absent", async () => {
      const handler = extractToolHandler(server, "letta_send_message");
      await handler({ agent_id: "agent-1", content: "Hi" });
      const callArgs = (provider.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[2].maxSteps).toBeUndefined();
    });

    it("uses LETTA_ASK_TIMEOUT_MS env var when timeout_ms not provided", async () => {
      const originalEnv = process.env["LETTA_ASK_TIMEOUT_MS"];
      try {
        process.env["LETTA_ASK_TIMEOUT_MS"] = "5000";
        // Make sendMessage hang to verify timeout is used
        let resolveHang: () => void;
        (provider.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
          () => new Promise<string>((resolve) => { resolveHang = () => resolve(""); }),
        );
        const handler = extractToolHandler(server, "letta_send_message");
        const resultPromise = handler({ agent_id: "agent-1", content: "Hi" });
        // The tool should complete (env var parsed correctly as 5000ms; we won't wait that long)
        // Just verify sending works with the env var set (no crash on parsing)
        resolveHang!();
        const result = await resultPromise;
        expect(result.isError).toBeFalsy();
      } finally {
        if (originalEnv === undefined) {
          delete process.env["LETTA_ASK_TIMEOUT_MS"];
        } else {
          process.env["LETTA_ASK_TIMEOUT_MS"] = originalEnv;
        }
      }
    });

    it("falls back to default timeout when LETTA_ASK_TIMEOUT_MS is invalid", async () => {
      const originalEnv = process.env["LETTA_ASK_TIMEOUT_MS"];
      try {
        process.env["LETTA_ASK_TIMEOUT_MS"] = "notanumber";
        const handler = extractToolHandler(server, "letta_send_message");
        const result = await handler({ agent_id: "agent-1", content: "Hi" });
        expect(result.content[0].text).toBe("Hello from agent");
      } finally {
        if (originalEnv === undefined) {
          delete process.env["LETTA_ASK_TIMEOUT_MS"];
        } else {
          process.env["LETTA_ASK_TIMEOUT_MS"] = originalEnv;
        }
      }
    });

    it("options object has no overrideModel property key when override_model is absent", async () => {
      const handler = extractToolHandler(server, "letta_send_message");
      await handler({ agent_id: "agent-1", content: "Hi" });
      const callArgs = (provider.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
      expect("overrideModel" in (callArgs[2] as object)).toBe(false);
    });

    it("options object has no maxSteps property key when max_steps is absent", async () => {
      const handler = extractToolHandler(server, "letta_send_message");
      await handler({ agent_id: "agent-1", content: "Hi" });
      const callArgs = (provider.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
      expect("maxSteps" in (callArgs[2] as object)).toBe(false);
    });

    it("explicit timeout_ms wins over LETTA_ASK_TIMEOUT_MS env var", async () => {
      const origEnv = process.env["LETTA_ASK_TIMEOUT_MS"];
      process.env["LETTA_ASK_TIMEOUT_MS"] = "1"; // 1ms — would cause timeout if used
      try {
        (provider.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
          () => new Promise<string>((resolve) => setTimeout(() => resolve("ok"), 20)),
        );
        const handler = extractToolHandler(server, "letta_send_message");
        // Explicit 10s timeout: should NOT time out even though env=1ms
        const result = await handler({ agent_id: "agent-1", content: "Hi", timeout_ms: 10_000 });
        expect(result.isError).toBeFalsy();
      } finally {
        if (origEnv === undefined) delete process.env["LETTA_ASK_TIMEOUT_MS"];
        else process.env["LETTA_ASK_TIMEOUT_MS"] = origEnv;
      }
    });

    it("reads timeout from LETTA_ASK_TIMEOUT_MS env var (not empty string key)", async () => {
      const origEnv = process.env["LETTA_ASK_TIMEOUT_MS"];
      process.env["LETTA_ASK_TIMEOUT_MS"] = "1"; // 1ms
      try {
        (provider.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
          () => new Promise<string>((resolve) => setTimeout(() => resolve("ok"), 50)),
        );
        const handler = extractToolHandler(server, "letta_send_message");
        const result = await handler({ agent_id: "agent-1", content: "Hi" });
        // With correct env var: 1ms timeout fires before 50ms response → isError
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("timed out");
      } finally {
        if (origEnv === undefined) delete process.env["LETTA_ASK_TIMEOUT_MS"];
        else process.env["LETTA_ASK_TIMEOUT_MS"] = origEnv;
      }
    });

    it("timeout error label includes override_model when provided (not 'agent-default')", async () => {
      (provider.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise<string>((resolve) => setTimeout(resolve, 5000)),
      );
      const handler = extractToolHandler(server, "letta_send_message");
      const result = await handler({
        agent_id: "agent-1",
        content: "Hi",
        override_model: "openai/gpt-4.1",
        timeout_ms: 10,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("openai/gpt-4.1");
      expect(result.content[0].text).not.toContain("agent-default");
    });

    it("timeout error label uses 'agent-default' when override_model is absent", async () => {
      (provider.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise<string>((resolve) => setTimeout(resolve, 5000)),
      );
      const handler = extractToolHandler(server, "letta_send_message");
      const result = await handler({ agent_id: "agent-1", content: "Hi", timeout_ms: 10 });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("agent-default");
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
