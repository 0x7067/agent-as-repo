import { describe, it, expect, vi } from "vitest";
import { LettaProvider } from "./letta-provider.js";

function makeMockClient() {
  return {
    agents: {
      create: vi.fn().mockResolvedValue({ id: "agent-abc" }),
      delete: vi.fn().mockResolvedValue(undefined),
      passages: {
        create: vi.fn().mockResolvedValue([{ id: "passage-1" }]),
      },
      messages: {
        create: vi.fn().mockResolvedValue({
          messages: [
            { message_type: "tool_call_message", tool_call: { name: "archival_memory_search" } },
            { message_type: "tool_return_message", tool_return: "results" },
            { message_type: "assistant_message", content: "Hello from agent" },
          ],
        }),
      },
    },
  };
}

describe("LettaProvider", () => {
  describe("createAgent", () => {
    it("returns agentId from Letta response", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(client as any);

      const result = await provider.createAgent({
        name: "repo-expert-my-app",
        repoName: "my-app",
        description: "Test repo",
        tags: ["repo-expert", "frontend"],
        model: "openai/gpt-4.1",
        embedding: "openai/text-embedding-3-small",
        memoryBlockLimit: 5000,
      });

      expect(result.agentId).toBe("agent-abc");
    });

    it("passes Letta-specific memory blocks", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(client as any);

      await provider.createAgent({
        name: "repo-expert-my-app",
        repoName: "my-app",
        description: "Test repo",
        tags: ["repo-expert"],
        model: "openai/gpt-4.1",
        embedding: "openai/text-embedding-3-small",
        memoryBlockLimit: 5000,
      });

      const call = client.agents.create.mock.calls[0][0];
      const labels = call.memory_blocks.map((b: any) => b.label);
      expect(labels).toEqual(["persona", "architecture", "conventions"]);
      for (const block of call.memory_blocks) {
        expect(block.limit).toBe(5000);
      }
    });

    it("calls buildPersona with repoName, description, and persona", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(client as any);

      await provider.createAgent({
        name: "repo-expert-my-app",
        repoName: "my-app",
        description: "A test repo",
        persona: "I am custom.",
        tags: ["repo-expert"],
        model: "openai/gpt-4.1",
        embedding: "openai/text-embedding-3-small",
        memoryBlockLimit: 5000,
      });

      const call = client.agents.create.mock.calls[0][0];
      const personaBlock = call.memory_blocks.find((b: any) => b.label === "persona");
      expect(personaBlock.value).toContain("I am custom.");
    });

    it("attaches archival_memory_search tool", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(client as any);

      await provider.createAgent({
        name: "repo-expert-my-app",
        repoName: "my-app",
        description: "Test",
        tags: [],
        model: "openai/gpt-4.1",
        embedding: "openai/text-embedding-3-small",
        memoryBlockLimit: 5000,
      });

      const call = client.agents.create.mock.calls[0][0];
      expect(call.tools).toContain("archival_memory_search");
    });

    it("passes model, embedding, and tags through", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(client as any);

      await provider.createAgent({
        name: "repo-expert-my-app",
        repoName: "my-app",
        description: "Test",
        tags: ["repo-expert", "mobile"],
        model: "openai/gpt-4.1",
        embedding: "openai/text-embedding-3-small",
        memoryBlockLimit: 5000,
      });

      const call = client.agents.create.mock.calls[0][0];
      expect(call.name).toBe("repo-expert-my-app");
      expect(call.model).toBe("openai/gpt-4.1");
      expect(call.embedding).toBe("openai/text-embedding-3-small");
      expect(call.tags).toEqual(["repo-expert", "mobile"]);
    });
  });

  describe("deleteAgent", () => {
    it("delegates to client.agents.delete", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(client as any);

      await provider.deleteAgent("agent-abc");

      expect(client.agents.delete).toHaveBeenCalledWith("agent-abc");
    });
  });

  describe("storePassage", () => {
    it("returns passage ID from Letta response", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(client as any);

      const id = await provider.storePassage("agent-abc", "some text");

      expect(id).toBe("passage-1");
      expect(client.agents.passages.create).toHaveBeenCalledWith("agent-abc", { text: "some text" });
    });
  });

  describe("sendMessage", () => {
    it("extracts assistant_message content from response", async () => {
      const client = makeMockClient();
      const provider = new LettaProvider(client as any);

      const reply = await provider.sendMessage("agent-abc", "How does auth work?");

      expect(reply).toBe("Hello from agent");
      expect(client.agents.messages.create).toHaveBeenCalledWith("agent-abc", {
        messages: [{ role: "user", content: "How does auth work?" }],
      });
    });

    it("returns empty string when no assistant message", async () => {
      const client = makeMockClient();
      client.agents.messages.create.mockResolvedValue({
        messages: [{ message_type: "tool_call_message" }],
      });
      const provider = new LettaProvider(client as any);

      const reply = await provider.sendMessage("agent-abc", "test");

      expect(reply).toBe("");
    });
  });
});
