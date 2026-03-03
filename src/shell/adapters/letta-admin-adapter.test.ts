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

const AGENT_ID = "agent-1";
const OPENAI_MODEL = "openai/gpt-4.1";
const PERSONA_VALUE = "I am Alice.";
const HUMAN_VALUE = "Unknown user.";

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
          { id: AGENT_ID, name: "Alice", description: "Test agent", model: OPENAI_MODEL },
          { id: "agent-2", name: "Bob", description: null, model: null },
        ]),
      ),
      retrieve: vi.fn().mockResolvedValue({
        id: AGENT_ID,
        name: "Alice",
        model: OPENAI_MODEL,
        blocks: [
          { label: "persona", value: PERSONA_VALUE, limit: 5000 },
          { label: "human", value: HUMAN_VALUE, limit: 5000 },
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
        { id: AGENT_ID, name: "Alice", description: "Test agent", model: OPENAI_MODEL },
        { id: "agent-2", name: "Bob", description: null, model: null },
      ]);
    });
  });

  describe("getAgent", () => {
    it("returns full agent details as record", async () => {
      const client = makeMockClient();
      const adapter = new LettaAdminAdapter(clientAs(client));

      const agent = await adapter.getAgent(AGENT_ID);

      expect(agent).toEqual({
        id: AGENT_ID,
        name: "Alice",
        model: OPENAI_MODEL,
        blocks: [
          { label: "persona", value: PERSONA_VALUE, limit: 5000 },
          { label: "human", value: HUMAN_VALUE, limit: 5000 },
        ],
      });
      expect(client.agents.retrieve).toHaveBeenCalledWith(AGENT_ID);
    });
  });

  describe("getCoreMemory", () => {
    it("returns memory blocks from agent", async () => {
      const client = makeMockClient();
      const adapter = new LettaAdminAdapter(clientAs(client));

      const blocks = await adapter.getCoreMemory(AGENT_ID);

      expect(blocks).toEqual([
        { label: "persona", value: PERSONA_VALUE, limit: 5000 },
        { label: "human", value: HUMAN_VALUE, limit: 5000 },
      ]);
    });

    it("returns empty array when agent has no blocks", async () => {
      const client = makeMockClient();
      client.agents.retrieve.mockResolvedValue({ id: AGENT_ID, name: "Alice", blocks: null });
      const adapter = new LettaAdminAdapter(clientAs(client));

      const blocks = await adapter.getCoreMemory(AGENT_ID);

      expect(blocks).toEqual([]);
    });
  });

  describe("searchPassages", () => {
    it("returns passage results", async () => {
      const client = makeMockClient();
      const adapter = new LettaAdminAdapter(clientAs(client));

      const results = await adapter.searchPassages(AGENT_ID, "auth");

      expect(results).toEqual([
        { id: "p-1", text: "found it" },
        { id: "p-2", text: "also this" },
      ]);
      expect(client.agents.passages.search).toHaveBeenCalledWith(AGENT_ID, { query: "auth", top_k: null });
    });

    it("passes limit as top_k", async () => {
      const client = makeMockClient();
      const adapter = new LettaAdminAdapter(clientAs(client));

      await adapter.searchPassages(AGENT_ID, "auth", 5);

      expect(client.agents.passages.search).toHaveBeenCalledWith(AGENT_ID, { query: "auth", top_k: 5 });
    });
  });
});
