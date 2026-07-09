import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildRuntime,
  getRuntimeOptionsFromEnv,
  main,
  parseModelCsv,
  parseNonNegativeInt,
  parsePositiveInt,
  registerTools,
} from "./mcp-server.js";
import type { AgentProvider } from "./ports/agent-provider.js";
import type { AdminPort } from "./ports/admin.js";

function makeMockProvider(): AgentProvider {
  return {
    createAgent: vi.fn(),
    deleteAgent: vi.fn(),
    storePassage: vi.fn<[], Promise<string>>().mockResolvedValue("p-new"),
    deletePassage: vi.fn<[], Promise<void>>().mockResolvedValue(),
    listPassages: vi.fn().mockResolvedValue([{ id: "p-1", text: "found it" }]),
    getBlock: vi.fn().mockResolvedValue({ value: "block value", limit: 5000 }),
    updateBlock: vi.fn().mockResolvedValue({ value: "Updated.", limit: 5000 }),
    sendMessage: vi.fn<[], Promise<string>>().mockResolvedValue("Hello from agent"),
  };
}

function makeMockAdmin(): AdminPort {
  return {
    listAgents: vi.fn().mockResolvedValue([
      { id: "agent-1", name: "Alice", description: "Test agent", model: "qwen3-coder:30b" },
      { id: "agent-2", name: "Bob", description: null, model: "llama3.1:8b" },
    ]),
    getAgent: vi.fn().mockResolvedValue({
      id: "agent-1",
      name: "Alice",
      model: "qwen3-coder:30b",
      blocks: [
        { label: "persona", value: "I am Alice.", limit: 5000 },
        { label: "architecture", value: "Layered.", limit: 5000 },
      ],
    }),
    getCoreMemory: vi.fn().mockResolvedValue([
      { label: "persona", value: "I am Alice.", limit: 5000 },
      { label: "architecture", value: "Layered.", limit: 5000 },
    ]),
    searchPassages: vi.fn().mockResolvedValue([
      { id: "p-1", text: "found it" },
    ]),
  } satisfies AdminPort;
}

type MockAdmin = ReturnType<typeof makeMockAdmin>;

interface ToolResult { content: Array<{ type: string; text: string }>; isError?: boolean }
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

interface RegisteredToolEntry {
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult>;
}

function extractToolHandler(server: McpServer, toolName: string): ToolHandler {
  const registeredTools = (server as unknown as { _registeredTools: Record<string, RegisteredToolEntry | undefined> })._registeredTools;
  const tool = registeredTools[toolName];
  if (!tool) throw new Error(`Tool ${toolName} not registered`);
  return (args) => tool.handler(args, {});
}

function parseToolJson(result: ToolResult): unknown {
  return JSON.parse(result.content[0].text);
}

function getSendMessageOptions(
  provider: AgentProvider,
): { overrideModel?: string; maxSteps?: number; signal?: AbortSignal } {
  const firstCall = (provider.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0] as
    | [string, string, { overrideModel?: string; maxSteps?: number; signal?: AbortSignal }]
    | undefined;
  if (firstCall === undefined) {
    throw new Error("Expected provider.sendMessage to have been called at least once");
  }
  return firstCall[2];
}

describe("parsePositiveInt", () => {
  it("returns fallback when raw is undefined", () => {
    expect(parsePositiveInt(undefined, 60_000)).toBe(60_000);
  });

  it("returns fallback when raw is zero or negative", () => {
    expect(parsePositiveInt("0", 60_000)).toBe(60_000);
    expect(parsePositiveInt("-5", 60_000)).toBe(60_000);
  });

  it("returns parsed int when raw is a positive integer string", () => {
    expect(parsePositiveInt("30000", 60_000)).toBe(30_000);
  });
});

describe("parseNonNegativeInt", () => {
  it("returns fallback for undefined, empty, NaN, negative", () => {
    expect(parseNonNegativeInt(undefined, 1)).toBe(1);
    expect(parseNonNegativeInt("", 1)).toBe(1);
    expect(parseNonNegativeInt("abc", 1)).toBe(1);
    expect(parseNonNegativeInt("-1", 1)).toBe(1);
  });

  it("returns parsed value for zero and positive integers", () => {
    expect(parseNonNegativeInt("0", 1)).toBe(0);
    expect(parseNonNegativeInt("3", 1)).toBe(3);
  });
});

describe("parseModelCsv", () => {
  it("returns empty array when value is undefined or empty", () => {
    expect(parseModelCsv()).toEqual([]);
    expect(parseModelCsv("")).toEqual([]);
  });

  it("splits, trims, and drops empty entries", () => {
    expect(parseModelCsv(" model-a , , model-b ")).toEqual(["model-a", "model-b"]);
  });
});

describe("getRuntimeOptionsFromEnv", () => {
  const keys = [
    "LLM_REQUEST_TIMEOUT_MS",
    "LLM_MAX_RETRIES_PER_MODEL",
    "LLM_RETRY_BASE_DELAY_MS",
    "LLM_FALLBACK_MODELS",
  ] as const;

  afterEach(() => {
    for (const key of keys) Reflect.deleteProperty(process.env, key);
  });

  it("uses defaults when env vars are absent", () => {
    expect(getRuntimeOptionsFromEnv()).toEqual({
      requestTimeoutMs: 20_000,
      maxRetriesPerModel: 1,
      retryBaseDelayMs: 600,
      fallbackModels: [],
    });
  });

  it("reads custom env values", () => {
    process.env["LLM_REQUEST_TIMEOUT_MS"] = "15000";
    process.env["LLM_MAX_RETRIES_PER_MODEL"] = "2";
    process.env["LLM_RETRY_BASE_DELAY_MS"] = "900";
    process.env["LLM_FALLBACK_MODELS"] = "model-a, model-b";

    expect(getRuntimeOptionsFromEnv()).toEqual({
      requestTimeoutMs: 15_000,
      maxRetriesPerModel: 2,
      retryBaseDelayMs: 900,
      fallbackModels: ["model-a", "model-b"],
    });
  });
});

describe("buildRuntime", () => {
  const envKeys = ["LLM_MODEL", "LLM_BASE_URL", "LLM_API_KEY", "LLM_EMBEDDING_MODEL"] as const;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "repo-expert-mcp-runtime-"));
    process.env["REPO_EXPERT_DATA_DIR"] = dataDir;
  });

  afterEach(() => {
    for (const key of envKeys) Reflect.deleteProperty(process.env, key);
    Reflect.deleteProperty(process.env, "REPO_EXPERT_DATA_DIR");
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("builds a provider and admin from env/defaults", async () => {
    const runtime = await buildRuntime();
    expect(runtime.provider).toBeDefined();
    expect(runtime.admin).toBeDefined();
    expect(typeof runtime.provider.sendMessage).toBe("function");
    expect(typeof runtime.admin.listAgents).toBe("function");
  });

  it("builds without throwing when a custom base URL and key are set", async () => {
    process.env["LLM_MODEL"] = "llama3.1:8b";
    process.env["LLM_BASE_URL"] = "https://openrouter.ai/api/v1";
    process.env["LLM_API_KEY"] = "sk-test";
    await expect(buildRuntime()).resolves.toBeDefined();
  });
});

describe("MCP Server tools", () => {
  let server: McpServer;
  let provider: AgentProvider;
  let admin: AdminPort;
  let mockAdmin: MockAdmin;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "0.0.1" });
    provider = makeMockProvider();
    mockAdmin = makeMockAdmin();
    admin = mockAdmin;
    registerTools(server, provider, admin);
  });

  it("content type is 'text' on success", async () => {
    const handler = extractToolHandler(server, "agent_list");
    const result = await handler({});
    expect(result.content[0].type).toBe("text");
  });

  it("content type is 'text' on error", async () => {
    (admin.listAgents as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    const handler = extractToolHandler(server, "agent_list");
    const result = await handler({});
    expect(result.content[0].type).toBe("text");
    expect(result.isError).toBe(true);
  });

  it("registers exactly the 8 provider-neutral tools", () => {
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools).length).toBe(8);
    // eslint-disable-next-line unicorn/no-array-sort
    expect(Object.keys(tools).sort((a, b) => a.localeCompare(b))).toEqual([
      "agent_call",
      "agent_delete_passage",
      "agent_get",
      "agent_get_core_memory",
      "agent_insert_passage",
      "agent_list",
      "agent_search_archival",
      "agent_update_block",
    ]);
  });

  describe("agent_list", () => {
    it("returns agent summaries", async () => {
      const handler = extractToolHandler(server, "agent_list");
      const result = await handler({});
      const data = parseToolJson(result) as Array<{ id: string; name: string }>;
      expect(data).toHaveLength(2);
      expect(data[0]).toEqual({ id: "agent-1", name: "Alice", description: "Test agent", model: "qwen3-coder:30b" });
    });

    it("stringifies non-Error rejections", async () => {
      (admin.listAgents as ReturnType<typeof vi.fn>).mockRejectedValue("plain failure");
      const handler = extractToolHandler(server, "agent_list");
      const result = await handler({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("plain failure");
    });
  });

  describe("agent_get", () => {
    it("returns full agent details", async () => {
      const handler = extractToolHandler(server, "agent_get");
      const result = await handler({ agent_id: "agent-1" });
      const data = parseToolJson(result) as { id: string; name: string };
      expect(data.id).toBe("agent-1");
      expect(mockAdmin.getAgent).toHaveBeenCalledWith("agent-1");
    });

    it("returns isError on failure", async () => {
      (admin.getAgent as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));
      const handler = extractToolHandler(server, "agent_get");
      const result = await handler({ agent_id: "agent-1" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("not found");
    });

    it("returns a clear 'agent not found' error for a nonexistent agent instead of succeeding empty", async () => {
      const handler = extractToolHandler(server, "agent_get");
      const result = await handler({ agent_id: "bad-id" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("agent not found: bad-id");
      expect(mockAdmin.getAgent).not.toHaveBeenCalled();
    });
  });

  describe("agent_call", () => {
    it("returns assistant message text", async () => {
      const handler = extractToolHandler(server, "agent_call");
      const result = await handler({ agent_id: "agent-1", content: "Hi" });
      expect(result.content[0].text).toBe("Hello from agent");
      expect(provider.sendMessage).toHaveBeenCalledWith("agent-1", "Hi", {
        signal: expect.any(AbortSignal) as AbortSignal,
      });
    });

    it("returns a clear 'agent not found' error for a nonexistent agent instead of succeeding empty", async () => {
      const handler = extractToolHandler(server, "agent_call");
      const result = await handler({ agent_id: "missing-agent", content: "Hi" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("agent not found: missing-agent");
      expect(provider.sendMessage).not.toHaveBeenCalled();
    });

    it("aborts the signal passed to provider.sendMessage when the request times out (no orphaned call)", async () => {
      let observedSignal: AbortSignal | undefined;
      vi.mocked(provider.sendMessage).mockImplementation((_agentId, _content, options) => {
        observedSignal = (options as { signal?: AbortSignal } | undefined)?.signal;
        return new Promise((resolve) => setTimeout(() => { resolve("late"); }, 5000));
      });
      const handler = extractToolHandler(server, "agent_call");
      const result = await handler({ agent_id: "agent-1", content: "Hi", timeout_ms: 10 });
      expect(result.isError).toBe(true);
      expect(observedSignal).toBeInstanceOf(AbortSignal);
      expect(observedSignal?.aborted).toBe(true);
    });

    it("returns isError on failure", async () => {
      (provider.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("timeout"));
      const handler = extractToolHandler(server, "agent_call");
      const result = await handler({ agent_id: "agent-1", content: "Hi" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("timeout");
    });

    it("passes overrideModel and maxSteps through to provider", async () => {
      const handler = extractToolHandler(server, "agent_call");
      await handler({
        agent_id: "agent-1",
        content: "Hi",
        override_model: "llama3.1:8b",
        max_steps: 3,
      });
      expect(provider.sendMessage).toHaveBeenCalledWith("agent-1", "Hi", {
        overrideModel: "llama3.1:8b",
        maxSteps: 3,
        signal: expect.any(AbortSignal) as AbortSignal,
      });
    });

    it("does not set overrideModel/maxSteps when absent, but always threads an AbortSignal", async () => {
      const handler = extractToolHandler(server, "agent_call");
      await handler({ agent_id: "agent-1", content: "Hi" });
      const options = getSendMessageOptions(provider);
      expect("overrideModel" in options).toBe(false);
      expect("maxSteps" in options).toBe(false);
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    it("reads timeout from REPO_EXPERT_ASK_TIMEOUT_MS env var", async () => {
      const origEnv = process.env["REPO_EXPERT_ASK_TIMEOUT_MS"];
      process.env["REPO_EXPERT_ASK_TIMEOUT_MS"] = "1"; // 1ms
      try {
        vi.mocked(provider.sendMessage).mockImplementation(
          () => new Promise<string>((resolve) => setTimeout(() => { resolve("ok"); }, 50)),
        );
        const handler = extractToolHandler(server, "agent_call");
        const result = await handler({ agent_id: "agent-1", content: "Hi" });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("timed out");
      } finally {
        if (origEnv === undefined) delete process.env["REPO_EXPERT_ASK_TIMEOUT_MS"];
        else process.env["REPO_EXPERT_ASK_TIMEOUT_MS"] = origEnv;
      }
    });

    it("explicit timeout_ms wins over env var", async () => {
      const origEnv = process.env["REPO_EXPERT_ASK_TIMEOUT_MS"];
      process.env["REPO_EXPERT_ASK_TIMEOUT_MS"] = "1";
      try {
        vi.mocked(provider.sendMessage).mockImplementation(
          () => new Promise<string>((resolve) => setTimeout(() => { resolve("ok"); }, 20)),
        );
        const handler = extractToolHandler(server, "agent_call");
        const result = await handler({ agent_id: "agent-1", content: "Hi", timeout_ms: 10_000 });
        expect(result.isError).toBeFalsy();
      } finally {
        if (origEnv === undefined) delete process.env["REPO_EXPERT_ASK_TIMEOUT_MS"];
        else process.env["REPO_EXPERT_ASK_TIMEOUT_MS"] = origEnv;
      }
    });

    it("timeout error label includes override_model when provided", async () => {
      vi.mocked(provider.sendMessage).mockImplementation(
        () => new Promise<string>((resolve) => setTimeout(resolve, 5000)),
      );
      const handler = extractToolHandler(server, "agent_call");
      const result = await handler({
        agent_id: "agent-1",
        content: "Hi",
        override_model: "llama3.1:8b",
        timeout_ms: 10,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("llama3.1:8b");
      expect(result.content[0].text).not.toContain("agent-default");
    });
  });

  describe("agent_get_core_memory", () => {
    it("returns memory blocks", async () => {
      const handler = extractToolHandler(server, "agent_get_core_memory");
      const result = await handler({ agent_id: "agent-1" });
      const data = parseToolJson(result) as Array<{ label: string }>;
      expect(data).toHaveLength(2);
      expect(data[0].label).toBe("persona");
    });

    it("returns isError on failure", async () => {
      (admin.getCoreMemory as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("agent gone"));
      const handler = extractToolHandler(server, "agent_get_core_memory");
      const result = await handler({ agent_id: "agent-1" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("agent gone");
    });

    it("returns a clear 'agent not found' error for a nonexistent agent instead of succeeding empty", async () => {
      const handler = extractToolHandler(server, "agent_get_core_memory");
      const result = await handler({ agent_id: "bad-id" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("agent not found: bad-id");
      expect(mockAdmin.getCoreMemory).not.toHaveBeenCalled();
    });
  });

  describe("agent_search_archival", () => {
    it("returns search results", async () => {
      const handler = extractToolHandler(server, "agent_search_archival");
      const result = await handler({ agent_id: "agent-1", query: "auth" });
      const data = parseToolJson(result) as Array<{ id: string; text: string }>;
      expect(data).toEqual([{ id: "p-1", text: "found it" }]);
      expect(mockAdmin.searchPassages).toHaveBeenCalledWith("agent-1", "auth", undefined, undefined);
    });

    it("passes top_k when provided", async () => {
      const handler = extractToolHandler(server, "agent_search_archival");
      await handler({ agent_id: "agent-1", query: "auth", top_k: 5 });
      expect(mockAdmin.searchPassages).toHaveBeenCalledWith("agent-1", "auth", 5, undefined);
    });

    it("forwards path_prefix to searchPassages", async () => {
      const handler = extractToolHandler(server, "agent_search_archival");
      await handler({ agent_id: "agent-1", query: "auth", path_prefix: "src/auth" });
      expect(mockAdmin.searchPassages).toHaveBeenCalledWith("agent-1", "auth", undefined, {
        pathPrefix: "src/auth",
      });
    });

    it("returns a clear 'agent not found' error for a nonexistent agent instead of succeeding empty", async () => {
      const handler = extractToolHandler(server, "agent_search_archival");
      const result = await handler({ agent_id: "bad-id", query: "auth" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("agent not found: bad-id");
      expect(mockAdmin.searchPassages).not.toHaveBeenCalled();
    });

    it("rejects non-integer/non-positive top_k at the schema level", () => {
      const registeredTools = (server as unknown as {
        _registeredTools: Record<
          string,
          { inputSchema?: { shape?: Record<string, { safeParse: (v: unknown) => { success: boolean } }> } } | undefined
        >;
      })._registeredTools;
      const tool = registeredTools["agent_search_archival"];
      const topKSchema = tool?.inputSchema?.shape?.["top_k"];
      expect(topKSchema).toBeDefined();
      expect(topKSchema?.safeParse(5).success).toBe(true);
      expect(topKSchema?.safeParse(0).success).toBe(false);
      expect(topKSchema?.safeParse(-1).success).toBe(false);
      expect(topKSchema?.safeParse(1.5).success).toBe(false);
    });
  });

  describe("agent_insert_passage", () => {
    it("inserts and returns the passage id", async () => {
      const handler = extractToolHandler(server, "agent_insert_passage");
      const result = await handler({ agent_id: "agent-1", text: "new passage" });
      const data = parseToolJson(result) as { id: string };
      expect(data.id).toBe("p-new");
      expect(provider.storePassage).toHaveBeenCalledWith("agent-1", "new passage");
    });

    it("returns a clear 'agent not found' error for a nonexistent agent instead of inserting", async () => {
      const handler = extractToolHandler(server, "agent_insert_passage");
      const result = await handler({ agent_id: "bad-id", text: "new passage" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("agent not found: bad-id");
      expect(provider.storePassage).not.toHaveBeenCalled();
    });
  });

  describe("agent_delete_passage", () => {
    it("deletes a passage", async () => {
      const handler = extractToolHandler(server, "agent_delete_passage");
      const result = await handler({ agent_id: "agent-1", passage_id: "p-1" });
      expect(result.content[0].text).toBe("Deleted");
      expect(provider.deletePassage).toHaveBeenCalledWith("agent-1", "p-1");
    });

    it("returns a not-found error instead of a false 'Deleted' for a nonexistent passage_id", async () => {
      const handler = extractToolHandler(server, "agent_delete_passage");
      const result = await handler({ agent_id: "agent-1", passage_id: "does-not-exist" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("passage not found: does-not-exist");
      expect(provider.deletePassage).not.toHaveBeenCalled();
    });

    it("returns a clear 'agent not found' error for a nonexistent agent instead of checking passages", async () => {
      const handler = extractToolHandler(server, "agent_delete_passage");
      const result = await handler({ agent_id: "bad-id", passage_id: "p-1" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("agent not found: bad-id");
      expect(provider.listPassages).not.toHaveBeenCalled();
      expect(provider.deletePassage).not.toHaveBeenCalled();
    });
  });

  describe("agent_update_block", () => {
    it("updates and returns the block", async () => {
      const handler = extractToolHandler(server, "agent_update_block");
      const result = await handler({ agent_id: "agent-1", label: "architecture", value: "Updated." });
      const data = parseToolJson(result) as { value: string; limit: number };
      expect(data.value).toBe("Updated.");
      expect(provider.updateBlock).toHaveBeenCalledWith("agent-1", "architecture", "Updated.");
    });

    it("returns isError on failure", async () => {
      (provider.updateBlock as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));
      const handler = extractToolHandler(server, "agent_update_block");
      const result = await handler({ agent_id: "agent-1", label: "architecture", value: "x" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("not found");
    });

    it("rejects persona block writes instead of silently overwriting the managed persona", async () => {
      const handler = extractToolHandler(server, "agent_update_block");
      const result = await handler({ agent_id: "agent-1", label: "persona", value: "New persona" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("persona");
      expect(provider.updateBlock).not.toHaveBeenCalled();
    });

    it("rejects a value over the memory block char limit", async () => {
      const handler = extractToolHandler(server, "agent_update_block");
      const oversized = "x".repeat(5001);
      const result = await handler({ agent_id: "agent-1", label: "architecture", value: oversized });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("limit");
      expect(provider.updateBlock).not.toHaveBeenCalled();
    });

    it("accepts a value exactly at the char limit", async () => {
      const handler = extractToolHandler(server, "agent_update_block");
      const atLimit = "x".repeat(5000);
      const result = await handler({ agent_id: "agent-1", label: "architecture", value: atLimit });
      expect(result.isError).toBeFalsy();
      expect(provider.updateBlock).toHaveBeenCalledWith("agent-1", "architecture", atLimit);
    });

    it("returns a clear 'agent not found' error for a nonexistent agent instead of updating", async () => {
      const handler = extractToolHandler(server, "agent_update_block");
      const result = await handler({ agent_id: "bad-id", label: "architecture", value: "Updated." });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("agent not found: bad-id");
      expect(provider.updateBlock).not.toHaveBeenCalled();
    });
  });
});

describe("main", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connects the server to a stdio transport", async () => {
    const connectSpy = vi.spyOn(McpServer.prototype, "connect").mockResolvedValue(undefined as never);
    await main();
    expect(connectSpy).toHaveBeenCalledOnce();
  });
});
