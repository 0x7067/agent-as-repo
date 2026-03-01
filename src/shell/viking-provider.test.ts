import { describe, it, expect, vi, beforeEach } from "vitest";
import { VikingProvider } from "./viking-provider.js";
import type { VikingHttpClient } from "./viking-http.js";

vi.mock("./openrouter-client.js", () => ({
  toolCallingLoop: vi.fn().mockResolvedValue("mocked response"),
}));

import { toolCallingLoop } from "./openrouter-client.js";

function makeMockViking() {
  return {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    listDirectory: vi.fn().mockResolvedValue([]),
    deleteResource: vi.fn().mockResolvedValue(undefined),
    semanticSearch: vi.fn().mockResolvedValue([]),
  } as unknown as VikingHttpClient;
}

const DEFAULT_MODEL = "openai/gpt-4o-mini";
const API_KEY = "test-api-key";

describe("VikingProvider", () => {
  let mockViking: VikingHttpClient;
  let provider: VikingProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockViking = makeMockViking();
    provider = new VikingProvider(mockViking, API_KEY, DEFAULT_MODEL);
  });

  describe("createAgent", () => {
    it("calls mkdir for directory tree, writes manifest + 3 blocks, returns { agentId: repoName }", async () => {
      const params = {
        name: "My Repo",
        repoName: "myrepo",
        description: "A test repo",
        tags: ["test"],
        model: "openai/gpt-4o",
        embedding: "openai/text-embedding-3-small",
        memoryBlockLimit: 5000,
      };

      const result = await provider.createAgent(params);

      expect(result).toEqual({ agentId: "myrepo" });

      // mkdir calls
      expect(mockViking.mkdir).toHaveBeenCalledWith("viking://resources/myrepo/");
      expect(mockViking.mkdir).toHaveBeenCalledWith("viking://resources/myrepo/blocks/");
      expect(mockViking.mkdir).toHaveBeenCalledWith("viking://resources/myrepo/passages/");

      // manifest write
      expect(mockViking.writeFile).toHaveBeenCalledWith(
        "viking://resources/myrepo/manifest.json",
        expect.stringContaining('"agentId":"myrepo"'),
      );

      // block writes
      expect(mockViking.writeFile).toHaveBeenCalledWith(
        "viking://resources/myrepo/blocks/architecture",
        "Not yet analyzed.",
      );
      expect(mockViking.writeFile).toHaveBeenCalledWith(
        "viking://resources/myrepo/blocks/conventions",
        "Not yet analyzed.",
      );
    });

    it("uses buildPersona to set persona block content containing repoName", async () => {
      const params = {
        name: "My Repo",
        repoName: "myrepo",
        description: "A test repo",
        tags: ["test"],
        model: "openai/gpt-4o",
        embedding: "openai/text-embedding-3-small",
        memoryBlockLimit: 5000,
      };

      await provider.createAgent(params);

      const personaCall = (mockViking.writeFile as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === "viking://resources/myrepo/blocks/persona",
      );
      expect(personaCall).toBeDefined();
      const personaContent = personaCall![1] as string;
      expect(personaContent).toContain("myrepo");
    });
  });

  describe("deleteAgent", () => {
    it("calls deleteResource with correct URI", async () => {
      await provider.deleteAgent("myrepo");

      expect(mockViking.deleteResource).toHaveBeenCalledWith("viking://resources/myrepo/");
    });
  });

  describe("enableSleeptime", () => {
    it("resolves without error and doesn't call any viking methods", async () => {
      await expect(provider.enableSleeptime("myrepo")).resolves.toBeUndefined();

      expect(mockViking.mkdir).not.toHaveBeenCalled();
      expect(mockViking.writeFile).not.toHaveBeenCalled();
      expect(mockViking.readFile).not.toHaveBeenCalled();
      expect(mockViking.deleteFile).not.toHaveBeenCalled();
      expect(mockViking.listDirectory).not.toHaveBeenCalled();
      expect(mockViking.deleteResource).not.toHaveBeenCalled();
      expect(mockViking.semanticSearch).not.toHaveBeenCalled();
    });
  });

  describe("storePassage", () => {
    it("calls writeFile with a UUID path under passages/ and returns the UUID", async () => {
      const passageId = await provider.storePassage("myrepo", "some passage text");

      expect(typeof passageId).toBe("string");
      expect(passageId.length).toBeGreaterThan(0);

      expect(mockViking.writeFile).toHaveBeenCalledWith(
        `viking://resources/myrepo/passages/${passageId}.txt`,
        "some passage text",
      );
    });
  });

  describe("deletePassage", () => {
    it("calls deleteFile with correct passage URI", async () => {
      await provider.deletePassage("myrepo", "abc-123");

      expect(mockViking.deleteFile).toHaveBeenCalledWith(
        "viking://resources/myrepo/passages/abc-123.txt",
      );
    });
  });

  describe("listPassages", () => {
    it("calls listDirectory, reads each file, returns passages with correct ids and text", async () => {
      (mockViking.listDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
        "viking://resources/myrepo/passages/uuid-1.txt",
        "viking://resources/myrepo/passages/uuid-2.txt",
      ]);
      (mockViking.readFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce("passage one")
        .mockResolvedValueOnce("passage two");

      const passages = await provider.listPassages("myrepo");

      expect(mockViking.listDirectory).toHaveBeenCalledWith(
        "viking://resources/myrepo/passages/",
      );
      expect(mockViking.readFile).toHaveBeenCalledWith(
        "viking://resources/myrepo/passages/uuid-1.txt",
      );
      expect(mockViking.readFile).toHaveBeenCalledWith(
        "viking://resources/myrepo/passages/uuid-2.txt",
      );
      expect(passages).toEqual([
        { id: "uuid-1", text: "passage one" },
        { id: "uuid-2", text: "passage two" },
      ]);
    });
  });

  describe("getBlock", () => {
    it("calls readFile with correct block URI and returns { value, limit: 5000 }", async () => {
      (mockViking.readFile as ReturnType<typeof vi.fn>).mockResolvedValue("block content");

      const block = await provider.getBlock("myrepo", "persona");

      expect(mockViking.readFile).toHaveBeenCalledWith(
        "viking://resources/myrepo/blocks/persona",
      );
      expect(block).toEqual({ value: "block content", limit: 5000 });
    });
  });

  describe("updateBlock", () => {
    it("calls writeFile with correct block URI and value, returns { value, limit: 5000 }", async () => {
      const block = await provider.updateBlock("myrepo", "architecture", "new architecture");

      expect(mockViking.writeFile).toHaveBeenCalledWith(
        "viking://resources/myrepo/blocks/architecture",
        "new architecture",
      );
      expect(block).toEqual({ value: "new architecture", limit: 5000 });
    });
  });

  describe("sendMessage", () => {
    beforeEach(() => {
      (mockViking.readFile as ReturnType<typeof vi.fn>).mockImplementation(async (uri: string) => {
        if (uri.includes("/blocks/persona")) return "I am the persona";
        if (uri.includes("/blocks/architecture")) return "Arch content";
        if (uri.includes("/blocks/conventions")) return "Conv content";
        return "";
      });
    });

    it("reads 3 blocks, calls toolCallingLoop with correct args", async () => {
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

    it("archival_memory_search handler calls semanticSearch and returns JSON", async () => {
      await provider.sendMessage("myrepo", "hello");

      const callArgs = vi.mocked(toolCallingLoop).mock.calls[0][0];
      const searchHandler = callArgs.toolHandlers["archival_memory_search"];

      (mockViking.semanticSearch as ReturnType<typeof vi.fn>).mockResolvedValue([
        { uri: "u", text: "t", score: 0.9 },
      ]);
      const result = await searchHandler({ query: "test query" });

      expect(mockViking.semanticSearch).toHaveBeenCalledWith(
        "test query",
        "viking://resources/myrepo/passages/",
        10,
      );
      expect(result).toBe(JSON.stringify([{ uri: "u", text: "t", score: 0.9 }]));
    });

    it("memory_replace handler calls writeFile via updateBlock and returns confirmation", async () => {
      await provider.sendMessage("myrepo", "hello");

      const callArgs = vi.mocked(toolCallingLoop).mock.calls[0][0];
      const replaceHandler = callArgs.toolHandlers["memory_replace"];

      // Clear previous calls from sendMessage's getBlock reads
      vi.clearAllMocks();
      (mockViking.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const result = await replaceHandler({ label: "architecture", value: "new arch" });

      expect(mockViking.writeFile).toHaveBeenCalledWith(
        "viking://resources/myrepo/blocks/architecture",
        "new arch",
      );
      expect(result).toBe("Updated block 'architecture'");
    });
  });
});
