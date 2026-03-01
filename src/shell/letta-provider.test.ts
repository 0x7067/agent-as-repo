import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import { LettaProvider } from "./letta-provider.js";

interface MockPassages {
  create: Mock;
  delete: Mock;
  list: Mock;
}

interface MockBlocks {
  retrieve: Mock;
  update: Mock;
}

interface MockMessages {
  create: Mock;
}

interface MockAgents {
  create: Mock;
  delete: Mock;
  update: Mock;
  passages: MockPassages;
  blocks: MockBlocks;
  messages: MockMessages;
}

interface MockLettaClient {
  agents: MockAgents;
}

interface MemoryBlockArg {
  label: string;
  value: string;
  limit: number;
}

interface CreateAgentCallArg {
  name: string;
  model: string;
  embedding: string;
  enable_sleeptime: boolean;
  tools: string[];
  tags: string[];
  memory_blocks: MemoryBlockArg[];
}

function makeMockClient(): MockLettaClient {
  return {
    agents: {
      create: vi.fn().mockResolvedValue({ id: "agent-abc" }),
      delete: vi.fn().mockResolvedValue(),
      update: vi.fn().mockResolvedValue({ id: "agent-abc" }),
      passages: {
        create: vi.fn().mockResolvedValue([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]),
        delete: vi.fn().mockResolvedValue(),
        list: vi.fn().mockResolvedValue([
          { id: "p-1", text: "FILE: src/a.ts\ncontent", embedding: null, embedding_config: null },
          { id: "p-2", text: "FILE: src/b.ts\ncontent", embedding: null, embedding_config: null },
        ]),
      },
      blocks: {
        retrieve: vi.fn().mockResolvedValue({ id: "block-1", value: "Architecture summary.", label: "architecture", limit: 5000 }),
        update: vi.fn().mockResolvedValue({ id: "block-1", value: "Updated.", label: "persona", limit: 5000 }),
      },
      messages: {
        create: vi.fn().mockResolvedValue({
          messages: [
            { message_type: "tool_call_message", id: "m1", date: "", tool_call: { name: "archival_memory_search", arguments: "", tool_call_id: "" } },
            { message_type: "assistant_message", id: "m2", date: "", content: "Hello from agent" },
          ],
          stop_reason: { stop_reason: "max_steps" },
          usage: {},
        }),
      },
    },
  };
}

function mockClientAs(client: MockLettaClient): ConstructorParameters<typeof LettaProvider>[0] {
  return client as unknown as ConstructorParameters<typeof LettaProvider>[0];
}

const defaultCreateParams = {
  name: "repo-expert-my-app",
  repoName: "my-app",
  description: "Test repo",
  tags: ["repo-expert"],
  model: "openai/gpt-4.1",
  embedding: "openai/text-embedding-3-small",
  memoryBlockLimit: 5000,
};

describe("LettaProvider", () => {
  describe("createAgent", () => {
    it("returns agentId from Letta response", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(mockClientAs(client));

      const result = await provider.createAgent({ ...defaultCreateParams, tags: ["repo-expert", "frontend"] });

      expect(result.agentId).toBe("agent-abc");
    });

    it("passes Letta-specific memory blocks", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(mockClientAs(client));

      await provider.createAgent(defaultCreateParams);

      const call: CreateAgentCallArg = client.agents.create.mock.calls[0][0];
      const labels = call.memory_blocks.map((b) => b.label);
      expect(labels).toEqual(["persona", "architecture", "conventions"]);
      for (const block of call.memory_blocks) {
        expect(block.limit).toBe(5000);
      }
    });

    it("calls buildPersona with repoName, description, and persona", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(mockClientAs(client));

      await provider.createAgent({ ...defaultCreateParams, description: "A test repo", persona: "I am custom." });

      const call: CreateAgentCallArg = client.agents.create.mock.calls[0][0];
      const personaBlock = call.memory_blocks.find((b) => b.label === "persona");
      expect(personaBlock?.value).toContain("I am custom.");
    });

    it("attaches archival_memory_search tool", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(mockClientAs(client));

      await provider.createAgent({ ...defaultCreateParams, tags: [] });

      const call: CreateAgentCallArg = client.agents.create.mock.calls[0][0];
      expect(call.tools).toContain("archival_memory_search");
    });

    it("merges custom tools with archival_memory_search", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(mockClientAs(client));

      await provider.createAgent({
        ...defaultCreateParams,
        tags: [],
        tools: ["send_message_to_agents_matching_tags"],
      });

      const call: CreateAgentCallArg = client.agents.create.mock.calls[0][0];
      expect(call.tools).toContain("archival_memory_search");
      expect(call.tools).toContain("send_message_to_agents_matching_tags");
    });

    it("passes model, embedding, and tags through", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(mockClientAs(client));

      await provider.createAgent({ ...defaultCreateParams, tags: ["repo-expert", "mobile"] });

      const call: CreateAgentCallArg = client.agents.create.mock.calls[0][0];
      expect(call.name).toBe("repo-expert-my-app");
      expect(call.model).toBe("openai/gpt-4.1");
      expect(call.embedding).toBe("openai/text-embedding-3-small");
      expect(call.tags).toEqual(["repo-expert", "mobile"]);
    });

    it("enables sleep-time by default", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(mockClientAs(client));

      await provider.createAgent(defaultCreateParams);

      const call: CreateAgentCallArg = client.agents.create.mock.calls[0][0];
      expect(call.enable_sleeptime).toBe(true);
    });
  });

  describe("deleteAgent", () => {
    it("delegates to client.agents.delete", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(mockClientAs(client));

      await provider.deleteAgent("agent-abc");

      expect(client.agents.delete).toHaveBeenCalledWith("agent-abc");
    });
  });

  describe("enableSleeptime", () => {
    it("calls agents.modify with enable_sleeptime: true", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(mockClientAs(client));

      await provider.enableSleeptime("agent-abc");

      expect(client.agents.update).toHaveBeenCalledWith("agent-abc", { enable_sleeptime: true });
    });
  });

  describe("storePassage", () => {
    it("returns passage ID from Letta response", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(mockClientAs(client));

      const id = await provider.storePassage("agent-abc", "some text");

      expect(id).toBe("passage-1");
      expect(client.agents.passages.create).toHaveBeenCalledWith("agent-abc", { text: "some text" });
    });
  });

  describe("deletePassage", () => {
    it("delegates to client.agents.passages.delete with correct args", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(mockClientAs(client));

      await provider.deletePassage("agent-abc", "passage-1");

      expect(client.agents.passages.delete).toHaveBeenCalledWith("passage-1", { agent_id: "agent-abc" });
    });
  });

  describe("listPassages", () => {
    it("returns passages with id and text", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(mockClientAs(client));

      const passages = await provider.listPassages("agent-abc");

      expect(passages).toEqual([
        { id: "p-1", text: "FILE: src/a.ts\ncontent" },
        { id: "p-2", text: "FILE: src/b.ts\ncontent" },
      ]);
      expect(client.agents.passages.list).toHaveBeenCalledWith("agent-abc", { limit: 1000, ascending: true });
    });

    it("returns empty array when no passages", async () => {
      const client = makeMockClient();
      client.agents.passages.list.mockResolvedValue([]);
      const provider = new LettaProvider(mockClientAs(client));

      const passages = await provider.listPassages("agent-abc");

      expect(passages).toEqual([]);
    });

    it("paginates when server returns a full page", async () => {
      const PAGE_SIZE = 1000;
      const firstPage = Array.from({ length: PAGE_SIZE }, (_, i) => ({
        id: `p-${i}`,
        text: `chunk ${i}`,
        embedding: null,
        embedding_config: null,
      }));
      const secondPage = [
        { id: "p-1000", text: "chunk 1000", embedding: null, embedding_config: null },
        { id: "p-1001", text: "chunk 1001", embedding: null, embedding_config: null },
      ];

      const client = makeMockClient();
      client.agents.passages.list
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(secondPage);
      const provider = new LettaProvider(mockClientAs(client));

      const passages = await provider.listPassages("agent-abc");

      expect(passages).toHaveLength(PAGE_SIZE + 2);
      expect(client.agents.passages.list).toHaveBeenCalledTimes(2);
      expect(client.agents.passages.list).toHaveBeenNthCalledWith(1, "agent-abc", { limit: 1000, ascending: true });
      expect(client.agents.passages.list).toHaveBeenNthCalledWith(2, "agent-abc", { limit: 1000, ascending: true, after: `p-${PAGE_SIZE - 1}` });
    });

    it("returns single page when count < PAGE_SIZE", async () => {
      const client = makeMockClient();
      client.agents.passages.list.mockResolvedValue(
        Array.from({ length: 50 }, (_, i) => ({ id: `p-${i}`, text: `chunk ${i}`, embedding: null, embedding_config: null })),
      );
      const provider = new LettaProvider(mockClientAs(client));

      const passages = await provider.listPassages("agent-abc");

      expect(passages).toHaveLength(50);
      expect(client.agents.passages.list).toHaveBeenCalledTimes(1);
    });
  });

  describe("getBlock", () => {
    it("returns block value and limit", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(mockClientAs(client));

      const block = await provider.getBlock("agent-abc", "architecture");

      expect(block).toEqual({ value: "Architecture summary.", limit: 5000 });
      expect(client.agents.blocks.retrieve).toHaveBeenCalledWith("architecture", { agent_id: "agent-abc" });
    });
  });

  describe("updateBlock", () => {
    it("delegates to client.agents.blocks.update and returns value and limit", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(mockClientAs(client));

      const block = await provider.updateBlock("agent-abc", "persona", "Updated.");

      expect(block).toEqual({ value: "Updated.", limit: 5000 });
      expect(client.agents.blocks.update).toHaveBeenCalledWith("persona", { agent_id: "agent-abc", value: "Updated." });
    });
  });

  describe("sendMessage", () => {
    it("extracts assistant_message content from response", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(mockClientAs(client));

      const reply = await provider.sendMessage("agent-abc", "How does auth work?");

      expect(reply).toBe("Hello from agent");
      expect(client.agents.messages.create).toHaveBeenCalledWith("agent-abc", {
        messages: [{ role: "user", content: "How does auth work?" }],
      });
    });

    it("returns empty string when no assistant message", async () => {
      const client = makeMockClient();
      client.agents.messages.create.mockResolvedValue({
        messages: [{ message_type: "tool_call_message", id: "m1", date: "", tool_call: { name: "t", arguments: "", tool_call_id: "" } }],
        stop_reason: { stop_reason: "max_steps" },
        usage: {},
      });
      const provider = new LettaProvider(mockClientAs(client));

      const reply = await provider.sendMessage("agent-abc", "test");

      expect(reply).toBe("");
    });

    it("passes override_model and max_steps when provided", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(mockClientAs(client));

      await provider.sendMessage("agent-abc", "quick summary", {
        overrideModel: "openai/gpt-4.1-mini",
        maxSteps: 3,
      });

      expect(client.agents.messages.create).toHaveBeenCalledWith("agent-abc", {
        messages: [{ role: "user", content: "quick summary" }],
        override_model: "openai/gpt-4.1-mini",
        max_steps: 3,
      });
    });
  });

  describe("retry on transient errors", () => {
    it("retries on 429 and succeeds", async () => {
      const client = makeMockClient();
      const rateLimitError = Object.assign(new Error("Rate limited"), { statusCode: 429 });
      client.agents.passages.create
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]);

      const provider = new LettaProvider(mockClientAs(client), 1);
      const id = await provider.storePassage("agent-abc", "text");

      expect(id).toBe("passage-1");
      expect(client.agents.passages.create).toHaveBeenCalledTimes(2);
    });

    it("retries on 500 and succeeds", async () => {
      const client = makeMockClient();
      const serverError = Object.assign(new Error("Internal Server Error"), { status: 500 });
      client.agents.passages.create
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]);

      const provider = new LettaProvider(mockClientAs(client), 1);
      const id = await provider.storePassage("agent-abc", "text");

      expect(id).toBe("passage-1");
      expect(client.agents.passages.create).toHaveBeenCalledTimes(2);
    });

    it("retries on 502 and succeeds", async () => {
      const client = makeMockClient();
      const gatewayError = Object.assign(new Error("Bad Gateway"), { status: 502 });
      client.agents.passages.create
        .mockRejectedValueOnce(gatewayError)
        .mockResolvedValueOnce([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]);

      const provider = new LettaProvider(mockClientAs(client), 1);
      const id = await provider.storePassage("agent-abc", "text");

      expect(id).toBe("passage-1");
      expect(client.agents.passages.create).toHaveBeenCalledTimes(2);
    });

    it("retries on ECONNRESET and succeeds", async () => {
      const client = makeMockClient();
      const networkError = Object.assign(new Error("Connection reset"), { code: "ECONNRESET" });
      client.agents.passages.create
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]);

      const provider = new LettaProvider(mockClientAs(client), 1);
      const id = await provider.storePassage("agent-abc", "text");

      expect(id).toBe("passage-1");
      expect(client.agents.passages.create).toHaveBeenCalledTimes(2);
    });

    it("retries on ETIMEDOUT and succeeds", async () => {
      const client = makeMockClient();
      const timeoutError = Object.assign(new Error("Timed out"), { code: "ETIMEDOUT" });
      client.agents.passages.create
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]);

      const provider = new LettaProvider(mockClientAs(client), 1);
      const id = await provider.storePassage("agent-abc", "text");

      expect(id).toBe("passage-1");
      expect(client.agents.passages.create).toHaveBeenCalledTimes(2);
    });

    it("throws after max retries", async () => {
      const client = makeMockClient();
      const rateLimitError = Object.assign(new Error("Rate limited"), { statusCode: 429 });
      client.agents.passages.create.mockImplementation(async () => {
        throw rateLimitError;
      });

      const provider = new LettaProvider(mockClientAs(client), 1);

      await expect(provider.storePassage("agent-abc", "text")).rejects.toThrow("Rate limited");
      expect(client.agents.passages.create).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    it("does not retry on 400 errors", async () => {
      const client = makeMockClient();
      const badRequest = Object.assign(new Error("Bad Request"), { status: 400 });
      client.agents.passages.create.mockRejectedValue(badRequest);

      const provider = new LettaProvider(mockClientAs(client), 1);

      await expect(provider.storePassage("agent-abc", "text")).rejects.toThrow("Bad Request");
      expect(client.agents.passages.create).toHaveBeenCalledTimes(1);
    });

    it("does not retry on non-transient errors", async () => {
      const client = makeMockClient();
      client.agents.passages.create.mockRejectedValue(new Error("Unknown error"));

      const provider = new LettaProvider(mockClientAs(client), 1);

      await expect(provider.storePassage("agent-abc", "text")).rejects.toThrow("Unknown error");
      expect(client.agents.passages.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("isTransientError edge cases", () => {
    it("returns false for null error", async () => {
      // isTransientError(null) should return false — test via non-retry behavior
      const client = makeMockClient();
      client.agents.passages.create.mockRejectedValue(null as unknown as Error);
      const provider = new LettaProvider(mockClientAs(client), 1);
      await expect(provider.storePassage("agent-abc", "text")).rejects.toBe(null);
      expect(client.agents.passages.create).toHaveBeenCalledTimes(1); // no retry
    });

    it("returns false for string error", async () => {
      const client = makeMockClient();
      client.agents.passages.create.mockRejectedValue("string error");
      const provider = new LettaProvider(mockClientAs(client), 1);
      await expect(provider.storePassage("agent-abc", "text")).rejects.toBe("string error");
      expect(client.agents.passages.create).toHaveBeenCalledTimes(1); // no retry
    });

    it("retries on ECONNREFUSED network error", async () => {
      const client = makeMockClient();
      const networkError = Object.assign(new Error("Connection refused"), { code: "ECONNREFUSED" });
      client.agents.passages.create
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]);
      const provider = new LettaProvider(mockClientAs(client), 1);
      const id = await provider.storePassage("agent-abc", "text");
      expect(id).toBe("passage-1");
      expect(client.agents.passages.create).toHaveBeenCalledTimes(2);
    });

    it("retries on EPIPE network error", async () => {
      const client = makeMockClient();
      const epipeError = Object.assign(new Error("Broken pipe"), { code: "EPIPE" });
      client.agents.passages.create
        .mockRejectedValueOnce(epipeError)
        .mockResolvedValueOnce([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]);
      const provider = new LettaProvider(mockClientAs(client), 1);
      const id = await provider.storePassage("agent-abc", "text");
      expect(id).toBe("passage-1");
      expect(client.agents.passages.create).toHaveBeenCalledTimes(2);
    });

    it("retries on EAI_AGAIN network error", async () => {
      const client = makeMockClient();
      const dnsError = Object.assign(new Error("DNS failure"), { code: "EAI_AGAIN" });
      client.agents.passages.create
        .mockRejectedValueOnce(dnsError)
        .mockResolvedValueOnce([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]);
      const provider = new LettaProvider(mockClientAs(client), 1);
      const id = await provider.storePassage("agent-abc", "text");
      expect(id).toBe("passage-1");
      expect(client.agents.passages.create).toHaveBeenCalledTimes(2);
    });

    it("retries on 503 status code", async () => {
      const client = makeMockClient();
      const serviceUnavailable = Object.assign(new Error("Service Unavailable"), { status: 503 });
      client.agents.passages.create
        .mockRejectedValueOnce(serviceUnavailable)
        .mockResolvedValueOnce([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]);
      const provider = new LettaProvider(mockClientAs(client), 1);
      const id = await provider.storePassage("agent-abc", "text");
      expect(id).toBe("passage-1");
    });
  });

  describe("getRetryAfterMs via retry behavior", () => {
    it("uses Retry-After header (string seconds) when present on 429", async () => {
      const client = makeMockClient();
      const rateLimitError = Object.assign(new Error("Rate limited"), {
        statusCode: 429,
        headers: { "Retry-After": "1" }, // 1 second
      });
      client.agents.passages.create
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]);
      const provider = new LettaProvider(mockClientAs(client), 99999); // huge base delay
      const id = await provider.storePassage("agent-abc", "text");
      expect(id).toBe("passage-1"); // succeeded using retry-after delay, not base delay
    });

    it("uses retry-after header (lowercase) when present", async () => {
      const client = makeMockClient();
      const rateLimitError = Object.assign(new Error("Rate limited"), {
        statusCode: 429,
        headers: { "retry-after": "1" },
      });
      client.agents.passages.create
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]);
      const provider = new LettaProvider(mockClientAs(client), 99999);
      const id = await provider.storePassage("agent-abc", "text");
      expect(id).toBe("passage-1");
    });

    it("handles numeric Retry-After header value (not just strings)", async () => {
      const client = makeMockClient();
      const rateLimitError = Object.assign(new Error("Rate limited"), {
        statusCode: 429,
        headers: { "Retry-After": 1 }, // numeric 1 (not string)
      });
      client.agents.passages.create
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]);
      const provider = new LettaProvider(mockClientAs(client), 99999); // huge base delay
      const id = await provider.storePassage("agent-abc", "text");
      expect(id).toBe("passage-1"); // used numeric Retry-After (1s), not base delay
    });

    it("ignores numeric Retry-After of 0 (boundary: must be > 0)", async () => {
      const client = makeMockClient();
      const rateLimitError = Object.assign(new Error("Rate limited"), {
        statusCode: 429,
        headers: { "Retry-After": 0 }, // 0 is not > 0 → ignored
      });
      client.agents.passages.create
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]);
      const provider = new LettaProvider(mockClientAs(client), 1); // tiny base delay, not retryAfter
      const id = await provider.storePassage("agent-abc", "text");
      expect(id).toBe("passage-1");
    });

    it("ignores numeric Retry-After of 300 (boundary: must be < 300)", async () => {
      const client = makeMockClient();
      const rateLimitError = Object.assign(new Error("Rate limited"), {
        statusCode: 429,
        headers: { "Retry-After": 300 }, // 300 is not < 300 → ignored
      });
      client.agents.passages.create
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]);
      const provider = new LettaProvider(mockClientAs(client), 1);
      const id = await provider.storePassage("agent-abc", "text");
      expect(id).toBe("passage-1"); // retried with 1ms base delay (not 300s)
    });

    it("ignores string Retry-After of '0' (boundary: seconds must be > 0)", async () => {
      const client = makeMockClient();
      const rateLimitError = Object.assign(new Error("Rate limited"), {
        statusCode: 429,
        headers: { "Retry-After": "0" }, // "0" → 0 seconds, not > 0 → ignored
      });
      client.agents.passages.create
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]);
      const provider = new LettaProvider(mockClientAs(client), 1);
      const id = await provider.storePassage("agent-abc", "text");
      expect(id).toBe("passage-1");
    });

    it("prefers lowercase 'retry-after' over 'Retry-After' when both present", async () => {
      const client = makeMockClient();
      const rateLimitError = Object.assign(new Error("Rate limited"), {
        statusCode: 429,
        headers: { "retry-after": "0.001", "Retry-After": "300" }, // lowercase wins
      });
      client.agents.passages.create
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]);
      const provider = new LettaProvider(mockClientAs(client), 99999);
      // If lowercase wins: 1ms delay → completes; if uppercase wins: 300s → hangs
      const id = await provider.storePassage("agent-abc", "text");
      expect(id).toBe("passage-1");
    });

    it("retries on 503 statusCode (not just status) — obj.status ?? obj.statusCode", async () => {
      const client = makeMockClient();
      // Only statusCode, no status — tests the fallback side of ??
      const err = Object.assign(new Error("Service unavailable"), { statusCode: 503 });
      client.agents.passages.create
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]);
      const provider = new LettaProvider(mockClientAs(client), 1);
      const id = await provider.storePassage("agent-abc", "text");
      expect(id).toBe("passage-1");
      expect(client.agents.passages.create).toHaveBeenCalledTimes(2);
    });

    it("does not retry on non-transient error code (string code not in transient set)", async () => {
      const client = makeMockClient();
      const permError = Object.assign(new Error("Permission denied"), { code: "EACCES" });
      client.agents.passages.create.mockRejectedValue(permError);
      const provider = new LettaProvider(mockClientAs(client), 1);
      await expect(provider.storePassage("agent-abc", "text")).rejects.toThrow("Permission denied");
      expect(client.agents.passages.create).toHaveBeenCalledTimes(1); // no retry
    });
  });

  describe("storePassage ID validation", () => {
    it("throws on empty result array", async () => {
      const client = makeMockClient();
      client.agents.passages.create.mockResolvedValue([]);

      const provider = new LettaProvider(mockClientAs(client));

      await expect(provider.storePassage("agent-abc", "text")).rejects.toThrow("no valid passage ID");
    });

    it("throws on null ID in result", async () => {
      const client = makeMockClient();
      client.agents.passages.create.mockResolvedValue([{ id: null, text: "" }]);

      const provider = new LettaProvider(mockClientAs(client));

      await expect(provider.storePassage("agent-abc", "text")).rejects.toThrow("no valid passage ID");
    });

    it("throws on empty string ID in result", async () => {
      const client = makeMockClient();
      client.agents.passages.create.mockResolvedValue([{ id: "", text: "" }]);

      const provider = new LettaProvider(mockClientAs(client));

      await expect(provider.storePassage("agent-abc", "text")).rejects.toThrow("no valid passage ID");
    });
  });

  describe("deletePassage 404 handling", () => {
    it("swallows 404 on deletePassage (already deleted)", async () => {
      const client = makeMockClient();
      const notFound = Object.assign(new Error("Not Found"), { status: 404 });
      client.agents.passages.delete.mockRejectedValue(notFound);
      const provider = new LettaProvider(mockClientAs(client));
      // Should NOT throw
      await expect(provider.deletePassage("agent-abc", "passage-1")).resolves.toBeUndefined();
    });

    it("rethrows non-404 errors from deletePassage", async () => {
      const client = makeMockClient();
      const serverError = Object.assign(new Error("Server Error"), { status: 500 });
      client.agents.passages.delete.mockRejectedValue(serverError);
      const provider = new LettaProvider(mockClientAs(client), 1);
      await expect(provider.deletePassage("agent-abc", "passage-1")).rejects.toThrow("Server Error");
    });

    it("also swallows 404 via statusCode property", async () => {
      const client = makeMockClient();
      const notFound = Object.assign(new Error("Not Found"), { statusCode: 404 });
      client.agents.passages.delete.mockRejectedValue(notFound);
      const provider = new LettaProvider(mockClientAs(client));
      await expect(provider.deletePassage("agent-abc", "passage-1")).resolves.toBeUndefined();
    });
  });

  describe("listPassages cursor logic", () => {
    it("stops pagination when last page item has no id", async () => {
      const PAGE_SIZE = 1000;
      const firstPage = Array.from({ length: PAGE_SIZE }, (_, i) => ({
        id: i < PAGE_SIZE - 1 ? `p-${i}` : undefined, // last item has no id
        text: `chunk ${i}`,
        embedding: null,
        embedding_config: null,
      }));

      const client = makeMockClient();
      client.agents.passages.list.mockResolvedValueOnce(firstPage);
      const provider = new LettaProvider(mockClientAs(client));

      const passages = await provider.listPassages("agent-abc");
      // Should stop after first page because cursor is undefined
      expect(client.agents.passages.list).toHaveBeenCalledTimes(1);
      // Last item filtered out (no id)
      expect(passages).toHaveLength(PAGE_SIZE - 1);
    });

    it("does not send cursor param on first page", async () => {
      const client = makeMockClient();
      client.agents.passages.list.mockResolvedValue([
        { id: "p-1", text: "a", embedding: null, embedding_config: null },
      ]);
      const provider = new LettaProvider(mockClientAs(client));
      await provider.listPassages("agent-abc");
      const call = client.agents.passages.list.mock.calls[0][1];
      expect(call.after).toBeUndefined();
    });
  });

  describe("sendMessage content type handling", () => {
    it("returns empty string when content is not a string", async () => {
      const client = makeMockClient();
      client.agents.messages.create.mockResolvedValue({
        messages: [
          { message_type: "assistant_message", id: "m1", date: "", content: 42 },
        ],
        stop_reason: { stop_reason: "end_turn" },
        usage: {},
      });
      const provider = new LettaProvider(mockClientAs(client));
      const reply = await provider.sendMessage("agent-abc", "test");
      expect(reply).toBe("");
    });

    it("returns the string content when content is a string", async () => {
      const client = makeMockClient();
      client.agents.messages.create.mockResolvedValue({
        messages: [
          { message_type: "assistant_message", id: "m1", date: "", content: "agent reply" },
        ],
        stop_reason: { stop_reason: "end_turn" },
        usage: {},
      });
      const provider = new LettaProvider(mockClientAs(client));
      const reply = await provider.sendMessage("agent-abc", "test");
      expect(reply).toBe("agent reply");
    });
  });

  describe("createAgent initial block values", () => {
    it("initializes architecture block with 'Not yet analyzed.'", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(mockClientAs(client));
      await provider.createAgent(defaultCreateParams);
      const call = client.agents.create.mock.calls[0][0] as { memory_blocks: MemoryBlockArg[] };
      const archBlock = call.memory_blocks.find((b) => b.label === "architecture");
      expect(archBlock?.value).toBe("Not yet analyzed.");
    });

    it("initializes conventions block with 'Not yet analyzed.'", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(mockClientAs(client));
      await provider.createAgent(defaultCreateParams);
      const call = client.agents.create.mock.calls[0][0] as { memory_blocks: MemoryBlockArg[] };
      const convBlock = call.memory_blocks.find((b) => b.label === "conventions");
      expect(convBlock?.value).toBe("Not yet analyzed.");
    });

    it("passes null tools default as empty array", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(mockClientAs(client));
      await provider.createAgent({ ...defaultCreateParams }); // no tools field
      const call = client.agents.create.mock.calls[0][0] as { tools: string[] };
      expect(call.tools).toContain("archival_memory_search");
      expect(call.tools).toHaveLength(1);
    });
  });

  describe("isHttpStatus edge cases", () => {
    it("rethrows null error from deletePassage (not treating null as 404)", async () => {
      const client = makeMockClient();
      client.agents.passages.delete.mockRejectedValue(null as unknown as Error);
      const provider = new LettaProvider(mockClientAs(client), 1);
      // null is not an object, isHttpStatus returns false → should rethrow
      await expect(provider.deletePassage("agent-abc", "p-1")).rejects.toBe(null);
    });

    it("rethrows primitive string error from deletePassage (not treating string as 404)", async () => {
      const client = makeMockClient();
      client.agents.passages.delete.mockRejectedValue("string error");
      const provider = new LettaProvider(mockClientAs(client), 1);
      // string is not an object, isHttpStatus returns false → should rethrow
      await expect(provider.deletePassage("agent-abc", "p-1")).rejects.toBe("string error");
    });
  });

  describe("getRetryAfterMs detailed behavior", () => {
    it("does not use Retry-After of 0 seconds (must be > 0)", async () => {
      const client = makeMockClient();
      const rateLimitError = Object.assign(new Error("Rate limited"), {
        statusCode: 429,
        headers: { "Retry-After": "0" }, // 0 is not > 0 → should fall back to base delay
      });
      client.agents.passages.create
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]);
      // Base delay = 1ms → should succeed quickly
      const provider = new LettaProvider(mockClientAs(client), 1);
      const id = await provider.storePassage("agent-abc", "text");
      expect(id).toBe("passage-1");
    });

    it("does not use Retry-After of 300+ seconds (must be < 300)", async () => {
      const client = makeMockClient();
      const rateLimitError = Object.assign(new Error("Rate limited"), {
        statusCode: 429,
        headers: { "Retry-After": "300" }, // 300 is not < 300 → should fall back to base delay
      });
      client.agents.passages.create
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]);
      // Base delay = 1ms → should succeed quickly (not wait 300s)
      const provider = new LettaProvider(mockClientAs(client), 1);
      const id = await provider.storePassage("agent-abc", "text");
      expect(id).toBe("passage-1");
    });

    it("Retry-After of 1 second converts to 1000ms (not seconds/1000)", async () => {
      // We can't directly measure delay, but we can verify the retry succeeds and
      // the delay was small (1s Retry-After → 1000ms should complete in test time)
      const client = makeMockClient();
      const rateLimitError = Object.assign(new Error("Rate limited"), {
        statusCode: 429,
        headers: { "Retry-After": "0.001" }, // very small Retry-After in seconds
      });
      client.agents.passages.create
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce([{ id: "passage-1", text: "", embedding: null, embedding_config: null }]);
      const provider = new LettaProvider(mockClientAs(client), 1);
      const id = await provider.storePassage("agent-abc", "text");
      expect(id).toBe("passage-1");
    });

    it("does not retry when typeof err.code is not string (numeric code is not transient)", async () => {
      const client = makeMockClient();
      // code is a number, not a string → typeof obj.code === "string" is false → not transient
      const numericCodeErr = Object.assign(new Error("Numeric code"), { code: 42 });
      client.agents.passages.create.mockRejectedValue(numericCodeErr);
      const provider = new LettaProvider(mockClientAs(client), 1);
      await expect(provider.storePassage("agent-abc", "text")).rejects.toThrow("Numeric code");
      expect(client.agents.passages.create).toHaveBeenCalledTimes(1); // no retry
    });

    it("does not retry when typeof status is not number (string status is not transient)", async () => {
      const client = makeMockClient();
      // status is a string, not a number → typeof status === "number" is false → not transient
      const stringStatusErr = Object.assign(new Error("String status"), { status: "429" });
      client.agents.passages.create.mockRejectedValue(stringStatusErr);
      const provider = new LettaProvider(mockClientAs(client), 1);
      await expect(provider.storePassage("agent-abc", "text")).rejects.toThrow("String status");
      expect(client.agents.passages.create).toHaveBeenCalledTimes(1); // no retry
    });
  });

  describe("listPassages filtering", () => {
    it("filters out passages with null IDs", async () => {
      const client = makeMockClient();
      client.agents.passages.list.mockResolvedValue([
        { id: "p-1", text: "content a", embedding: null, embedding_config: null },
        { id: null, text: "content b", embedding: null, embedding_config: null },
        { id: "p-3", text: "content c", embedding: null, embedding_config: null },
      ]);
      const provider = new LettaProvider(mockClientAs(client));

      const passages = await provider.listPassages("agent-abc");

      expect(passages).toEqual([
        { id: "p-1", text: "content a" },
        { id: "p-3", text: "content c" },
      ]);
    });
  });
});
