import { describe, it, expect, vi, beforeEach } from "vitest";
import { VikingProvider } from "./viking-provider.js";
import type { PassageStore } from "../ports/passage-store.js";
import type { BlockStorage } from "./block-storage.js";

vi.mock("./llm-client.js", () => ({
  DEFAULT_LLM_BASE_URL: "http://localhost:11434/v1",
  toolCallingLoop: vi.fn().mockResolvedValue("mocked response"),
}));

import { toolCallingLoop } from "./llm-client.js";

function makeMockStore() {
  return {
    initAgent: vi.fn().mockResolvedValue(),
    deleteAgent: vi.fn().mockResolvedValue(),
    listAgents: vi.fn().mockResolvedValue([]),
    writePassage: vi.fn().mockResolvedValue(),
    readPassage: vi.fn().mockResolvedValue(""),
    deletePassage: vi.fn().mockResolvedValue(),
    listPassages: vi.fn().mockResolvedValue([]),
    semanticSearch: vi.fn().mockResolvedValue([]),
  } satisfies Record<keyof PassageStore, ReturnType<typeof vi.fn>>;
}

function makeMockBlockStorage() {
  return {
    get: vi.fn().mockReturnValue(""),
    set: vi.fn(),
    init: vi.fn(),
    delete: vi.fn(),
  } satisfies BlockStorage;
}

type MockStore = ReturnType<typeof makeMockStore>;
type MockBlockStorage = ReturnType<typeof makeMockBlockStorage>;

const DEFAULT_MODEL = "openai/gpt-4o-mini";
const API_KEY = "test-api-key";

describe("VikingProvider", () => {
  let mockStore: MockStore;
  let mockBlockStorage: MockBlockStorage;
  let provider: VikingProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore = makeMockStore();
    mockBlockStorage = makeMockBlockStorage();
    provider = new VikingProvider(
      mockStore as unknown as PassageStore,
      DEFAULT_MODEL,
      mockBlockStorage as unknown as BlockStorage,
      { apiKey: API_KEY },
    );
  });

  describe("createAgent", () => {
    it("initializes the store with a manifest, inits blocks, returns { agentId: repoName }", async () => {
      const params = {
        name: "My Repo",
        repoName: "myrepo",
        description: "A test repo",
        tags: ["test"],
        model: "openai/gpt-4o",
        memoryBlockLimit: 5000,
      };

      const result = await provider.createAgent(params);

      expect(result).toEqual({ agentId: "myrepo" });

      expect(mockStore.initAgent).toHaveBeenCalledWith(
        "myrepo",
        expect.objectContaining({
          agentId: "myrepo",
          name: "My Repo",
          model: "openai/gpt-4o",
          tags: ["test"],
        }),
      );

      expect(mockBlockStorage.init).toHaveBeenCalledWith(
        "myrepo",
        expect.objectContaining({
          architecture: "Not yet analyzed.",
          conventions: "Not yet analyzed.",
        }),
      );
    });

    it("uses buildPersona to set persona block content containing repoName", async () => {
      const params = {
        name: "My Repo",
        repoName: "myrepo",
        description: "A test repo",
        tags: ["test"],
        model: "openai/gpt-4o",
        memoryBlockLimit: 5000,
      };

      await provider.createAgent(params);

      const initCall = (mockBlockStorage.init as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(initCall).toBeDefined();
      const blocks = initCall[1] as Record<string, string>;
      expect(blocks["persona"]).toContain("myrepo");
    });
  });

  describe("deleteAgent", () => {
    it("deletes the agent from the store and deletes blocks", async () => {
      await provider.deleteAgent("myrepo");

      expect(mockStore.deleteAgent).toHaveBeenCalledWith("myrepo");
      expect(mockBlockStorage.delete).toHaveBeenCalledWith("myrepo");
    });
  });

  describe("storePassage", () => {
    it("writes the passage under a generated UUID and returns the UUID", async () => {
      const passageId = await provider.storePassage("myrepo", "some passage text");

      expect(typeof passageId).toBe("string");
      expect(passageId.length).toBeGreaterThan(0);

      expect(mockStore.writePassage).toHaveBeenCalledWith("myrepo", passageId, "some passage text");
    });
  });

  describe("deletePassage", () => {
    it("delegates to the store", async () => {
      await provider.deletePassage("myrepo", "abc-123");

      expect(mockStore.deletePassage).toHaveBeenCalledWith("myrepo", "abc-123");
    });

    it("propagates store errors", async () => {
      mockStore.deletePassage.mockRejectedValue(new Error("HTTP 404 from x"));

      await expect(provider.deletePassage("myrepo", "abc-123")).rejects.toThrow("HTTP 404");
    });
  });

  describe("listPassages", () => {
    it("delegates to the store and returns its passages", async () => {
      mockStore.listPassages.mockResolvedValue([
        { id: "uuid-1", text: "passage one" },
        { id: "uuid-2", text: "passage two" },
      ]);

      const passages = await provider.listPassages("myrepo");

      expect(mockStore.listPassages).toHaveBeenCalledWith("myrepo");
      expect(passages).toEqual([
        { id: "uuid-1", text: "passage one" },
        { id: "uuid-2", text: "passage two" },
      ]);
    });
  });

  describe("getBlock", () => {
    it("reads from blockStorage and returns { value, limit: 5000 }", async () => {
      (mockBlockStorage.get as ReturnType<typeof vi.fn>).mockReturnValue("block content");

      const block = await provider.getBlock("myrepo", "persona");

      expect(mockBlockStorage.get).toHaveBeenCalledWith("myrepo", "persona");
      expect(block).toEqual({ value: "block content", limit: 5000 });
    });
  });

  describe("updateBlock", () => {
    it("writes to blockStorage and returns { value, limit: 5000 }", async () => {
      const block = await provider.updateBlock("myrepo", "architecture", "new architecture");

      expect(mockBlockStorage.set).toHaveBeenCalledWith("myrepo", "architecture", "new architecture");
      expect(block).toEqual({ value: "new architecture", limit: 5000 });
    });
  });

  describe("sendMessage", () => {
    beforeEach(() => {
      (mockBlockStorage.get as ReturnType<typeof vi.fn>).mockImplementation((_agentId: string, label: string) => {
        if (label === "persona") return "I am the persona";
        if (label === "architecture") return "Arch content";
        if (label === "conventions") return "Conv content";
        return "";
      });
    });

    it("reads 3 blocks from blockStorage, calls toolCallingLoop with correct args", async () => {
      const result = await provider.sendMessage("myrepo", "hello");

      expect(result).toBe("mocked response");

      expect(vi.mocked(toolCallingLoop)).toHaveBeenCalledWith(
        expect.objectContaining({
          userMessage: "hello",
          model: DEFAULT_MODEL,
          apiKey: API_KEY,
        }),
      );

      const callArgs = vi.mocked(toolCallingLoop).mock.calls[0][0];
      expect(callArgs.systemPrompt).toContain("I am the persona");
      expect(callArgs.systemPrompt).toContain("Arch content");
      expect(callArgs.systemPrompt).toContain("Conv content");
      expect(callArgs.tools).toHaveLength(2);
    });

    it("passes options.overrideModel as model to toolCallingLoop", async () => {
      await provider.sendMessage("myrepo", "hello", { overrideModel: "anthropic/claude-3-haiku" });

      expect(vi.mocked(toolCallingLoop)).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "anthropic/claude-3-haiku",
        }),
      );
    });

    it("retries the same model on retryable errors", async () => {
      provider = new VikingProvider(mockStore, DEFAULT_MODEL, mockBlockStorage, {
        apiKey: API_KEY,
        maxRetriesPerModel: 1,
        retryBaseDelayMs: 0,
      });

      vi.mocked(toolCallingLoop)
        .mockRejectedValueOnce(new Error("HTTP 503 from https://openrouter.ai/api/v1/chat/completions"))
        .mockResolvedValueOnce("recovered response");

      const result = await provider.sendMessage("myrepo", "hello");

      expect(result).toBe("recovered response");
      expect(vi.mocked(toolCallingLoop)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(toolCallingLoop).mock.calls[0][0].model).toBe(DEFAULT_MODEL);
      expect(vi.mocked(toolCallingLoop).mock.calls[1][0].model).toBe(DEFAULT_MODEL);
    });

    it("falls back to secondary model after primary retries are exhausted", async () => {
      provider = new VikingProvider(mockStore, DEFAULT_MODEL, mockBlockStorage, {
        apiKey: API_KEY,
        fallbackModels: ["moonshotai/kimi-k2.5"],
        maxRetriesPerModel: 0,
        retryBaseDelayMs: 0,
      });

      vi.mocked(toolCallingLoop)
        .mockRejectedValueOnce(new Error("OpenRouter request timed out after 20000ms"))
        .mockResolvedValueOnce("fallback model response");

      const result = await provider.sendMessage("myrepo", "hello");

      expect(result).toBe("fallback model response");
      expect(vi.mocked(toolCallingLoop)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(toolCallingLoop).mock.calls[0][0].model).toBe(DEFAULT_MODEL);
      expect(vi.mocked(toolCallingLoop).mock.calls[1][0].model).toBe("moonshotai/kimi-k2.5");
    });

    it("does not fallback when overrideModel is explicitly provided", async () => {
      provider = new VikingProvider(mockStore, DEFAULT_MODEL, mockBlockStorage, {
        apiKey: API_KEY,
        fallbackModels: ["moonshotai/kimi-k2.5"],
        maxRetriesPerModel: 0,
        retryBaseDelayMs: 0,
      });

      vi.mocked(toolCallingLoop)
        .mockRejectedValueOnce(new Error("OpenRouter request timed out after 20000ms"));

      await expect(
        provider.sendMessage("myrepo", "hello", { overrideModel: "z-ai/glm-5" }),
      ).rejects.toThrow("All model attempts failed");

      expect(vi.mocked(toolCallingLoop)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toolCallingLoop).mock.calls[0][0].model).toBe("z-ai/glm-5");
    });

    it("archival_memory_search handler calls store.semanticSearch and returns JSON", async () => {
      await provider.sendMessage("myrepo", "hello");

      const callArgs = vi.mocked(toolCallingLoop).mock.calls[0][0];
      const searchHandler = callArgs.toolHandlers["archival_memory_search"];

      mockStore.semanticSearch.mockResolvedValue([
        { id: "p-1", text: "t", score: 0.9 },
      ]);
      const result = await searchHandler({ query: "test query" });

      expect(mockStore.semanticSearch).toHaveBeenCalledWith("myrepo", "test query", 10);
      expect(result).toBe(JSON.stringify([{ id: "p-1", text: "t", score: 0.9 }]));
    });

    it("memory_replace handler calls blockStorage.set via updateBlock and returns confirmation", async () => {
      await provider.sendMessage("myrepo", "hello");

      const callArgs = vi.mocked(toolCallingLoop).mock.calls[0][0];
      const replaceHandler = callArgs.toolHandlers["memory_replace"];

      vi.clearAllMocks();

      const result = await replaceHandler({ label: "architecture", value: "new arch" });

      expect(mockBlockStorage.set).toHaveBeenCalledWith("myrepo", "architecture", "new arch");
      expect(result).toBe("Updated block 'architecture'");
    });
  });

  describe("consolidateMemory", () => {
    it("exposes only the memory_replace tool and uses the consolidation prompt", async () => {
      await provider.consolidateMemory("myrepo", "consolidate please");

      const callArgs = vi.mocked(toolCallingLoop).mock.calls[0][0];
      expect(callArgs.userMessage).toBe("consolidate please");
      expect(callArgs.tools).toHaveLength(1);
      expect(callArgs.tools[0]?.function.name).toBe("memory_replace");
      expect(callArgs.toolHandlers["archival_memory_search"]).toBeUndefined();
      expect(callArgs.maxSteps).toBe(2);
    });

    it("writes architecture/conventions blocks within the limit", async () => {
      await provider.consolidateMemory("myrepo", "prompt", { blockCharLimit: 100 });
      const handler = vi.mocked(toolCallingLoop).mock.calls[0][0].toolHandlers["memory_replace"];

      vi.clearAllMocks();
      const result = await handler({ label: "conventions", value: "new conv" });

      expect(mockBlockStorage.set).toHaveBeenCalledWith("myrepo", "conventions", "new conv");
      expect(result).toBe("Updated block 'conventions'");
    });

    it("rejects persona writes without touching block storage", async () => {
      await provider.consolidateMemory("myrepo", "prompt");
      const handler = vi.mocked(toolCallingLoop).mock.calls[0][0].toolHandlers["memory_replace"];

      vi.clearAllMocks();
      const result = await handler({ label: "persona", value: "hacked" });

      expect(mockBlockStorage.set).not.toHaveBeenCalled();
      expect(result).toContain("cannot be modified");
    });

    it("rejects values over the block char limit and keeps the old block", async () => {
      await provider.consolidateMemory("myrepo", "prompt", { blockCharLimit: 10 });
      const handler = vi.mocked(toolCallingLoop).mock.calls[0][0].toolHandlers["memory_replace"];

      vi.clearAllMocks();
      const result = await handler({ label: "architecture", value: "x".repeat(50) });

      expect(mockBlockStorage.set).not.toHaveBeenCalled();
      expect(result).toContain("over the 10-char limit");
    });
  });
});
