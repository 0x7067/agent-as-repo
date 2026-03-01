import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import { LettaAdminAdapter } from "./letta-admin-adapter.js";

interface MockPassages {
  search: Mock;
}

interface MockAgents {
  list: Mock;
  retrieve: Mock;
  passages: MockPassages;
}

interface MockLettaClient {
  agents: MockAgents;
}

function makeAsyncIterable<T>(items: T[]) {
  return {
    [Symbol.asyncIterator]: function* () {
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
          { id: "agent-2", name: "Bob", description: null, model: null },
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
        search: vi.fn().mockResolvedValue([
          { id: "p-1", text: "found it" },
          { id: "p-2", text: "also this" },
        ]),
      },
    },
  };
}

function clientAs(mock: MockLettaClient): ConstructorParameters<typeof LettaAdminAdapter>[0] {
  return mock as unknown as ConstructorParameters<typeof LettaAdminAdapter>[0];
}

describe("LettaAdminAdapter", () => {
  describe("listAgents", () => {
    it("returns agent summaries from async iterable", async () => {
      const client = makeMockClient();
      const adapter = new LettaAdminAdapter(clientAs(client));

      const agents = await adapter.listAgents();

      expect(agents).toEqual([
        { id: "agent-1", name: "Alice", description: "Test agent", model: "openai/gpt-4.1" },
        { id: "agent-2", name: "Bob", description: null, model: null },
      ]);
    });
  });

  describe("getAgent", () => {
    it("returns full agent details as record", async () => {
      const client = makeMockClient();
      const adapter = new LettaAdminAdapter(clientAs(client));

      const agent = await adapter.getAgent("agent-1");

      expect(agent).toEqual({
        id: "agent-1",
        name: "Alice",
        model: "openai/gpt-4.1",
        blocks: [
          { label: "persona", value: "I am Alice.", limit: 5000 },
          { label: "human", value: "Unknown user.", limit: 5000 },
        ],
      });
      expect(client.agents.retrieve).toHaveBeenCalledWith("agent-1");
    });
  });

  describe("getCoreMemory", () => {
    it("returns memory blocks from agent", async () => {
      const client = makeMockClient();
      const adapter = new LettaAdminAdapter(clientAs(client));

      const blocks = await adapter.getCoreMemory("agent-1");

      expect(blocks).toEqual([
        { label: "persona", value: "I am Alice.", limit: 5000 },
        { label: "human", value: "Unknown user.", limit: 5000 },
      ]);
    });

    it("returns empty array when agent has no blocks", async () => {
      const client = makeMockClient();
      client.agents.retrieve.mockResolvedValue({ id: "agent-1", name: "Alice", blocks: null });
      const adapter = new LettaAdminAdapter(clientAs(client));

      const blocks = await adapter.getCoreMemory("agent-1");

      expect(blocks).toEqual([]);
    });
  });

  describe("searchPassages", () => {
    it("returns passage results", async () => {
      const client = makeMockClient();
      const adapter = new LettaAdminAdapter(clientAs(client));

      const results = await adapter.searchPassages("agent-1", "auth");

      expect(results).toEqual([
        { id: "p-1", text: "found it" },
        { id: "p-2", text: "also this" },
      ]);
      expect(client.agents.passages.search).toHaveBeenCalledWith("agent-1", { query: "auth", top_k: undefined });
    });

    it("passes limit as top_k", async () => {
      const client = makeMockClient();
      const adapter = new LettaAdminAdapter(clientAs(client));

      await adapter.searchPassages("agent-1", "auth", 5);

      expect(client.agents.passages.search).toHaveBeenCalledWith("agent-1", { query: "auth", top_k: 5 });
    });
  });
});
