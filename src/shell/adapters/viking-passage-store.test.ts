import { describe, it, expect, vi, beforeEach } from "vitest";
import { VikingPassageStore } from "./viking-passage-store.js";
import type { VikingHttpClient } from "../viking-http.js";

interface VikingHttpClientMethods {
  mkdir: VikingHttpClient["mkdir"];
  writeFile: VikingHttpClient["writeFile"];
  readFile: VikingHttpClient["readFile"];
  deleteFile: VikingHttpClient["deleteFile"];
  listDirectory: VikingHttpClient["listDirectory"];
  deleteResource: VikingHttpClient["deleteResource"];
  semanticSearch: VikingHttpClient["semanticSearch"];
}

function makeMockViking() {
  return {
    mkdir: vi.fn().mockResolvedValue(),
    writeFile: vi.fn().mockResolvedValue(),
    readFile: vi.fn().mockResolvedValue(""),
    deleteFile: vi.fn().mockResolvedValue(),
    listDirectory: vi.fn().mockResolvedValue([]),
    deleteResource: vi.fn().mockResolvedValue(),
    semanticSearch: vi.fn().mockResolvedValue([]),
  } satisfies VikingHttpClientMethods;
}

type MockViking = ReturnType<typeof makeMockViking>;

describe("VikingPassageStore", () => {
  let mockViking: MockViking;
  let store: VikingPassageStore;

  beforeEach(() => {
    vi.clearAllMocks();
    mockViking = makeMockViking();
    store = new VikingPassageStore(mockViking as unknown as VikingHttpClient);
  });

  describe("initAgent", () => {
    it("creates root and passages dirs and writes the manifest", async () => {
      const manifest = {
        agentId: "myrepo",
        name: "repo-expert-myrepo",
        model: "some-model",
        tags: ["repo-expert"],
        createdAt: "2026-07-04T00:00:00.000Z",
      };

      await store.initAgent("myrepo", manifest);

      expect(mockViking.mkdir).toHaveBeenCalledWith("viking://resources/myrepo/");
      expect(mockViking.mkdir).toHaveBeenCalledWith("viking://resources/myrepo/passages/");
      expect(mockViking.writeFile).toHaveBeenCalledWith(
        "viking://resources/myrepo/manifest.json",
        JSON.stringify(manifest),
      );
    });
  });

  describe("deleteAgent", () => {
    it("deletes the agent's resource tree", async () => {
      await store.deleteAgent("myrepo");

      expect(mockViking.deleteResource).toHaveBeenCalledWith("viking://resources/myrepo/");
    });
  });

  describe("listAgents", () => {
    it("maps resource URIs to agent ids", async () => {
      mockViking.listDirectory.mockResolvedValue([
        "viking://resources/repo-a/",
        "viking://resources/repo-b/",
      ]);

      const agents = await store.listAgents();

      expect(mockViking.listDirectory).toHaveBeenCalledWith("viking://resources/");
      expect(agents).toEqual(["repo-a", "repo-b"]);
    });
  });

  describe("writePassage", () => {
    it("writes the text at the passage URI", async () => {
      await store.writePassage("myrepo", "uuid-1", "some passage text");

      expect(mockViking.writeFile).toHaveBeenCalledWith(
        "viking://resources/myrepo/passages/uuid-1.txt",
        "some passage text",
      );
    });
  });

  describe("readPassage", () => {
    it("reads the text at the passage URI", async () => {
      mockViking.readFile.mockResolvedValue("stored text");

      const text = await store.readPassage("myrepo", "uuid-1");

      expect(mockViking.readFile).toHaveBeenCalledWith(
        "viking://resources/myrepo/passages/uuid-1.txt",
      );
      expect(text).toBe("stored text");
    });
  });

  describe("deletePassage", () => {
    it("calls deleteFile with the passage URI", async () => {
      await store.deletePassage("myrepo", "abc-123");

      expect(mockViking.deleteFile).toHaveBeenCalledWith(
        "viking://resources/myrepo/passages/abc-123.txt",
      );
    });

    it("treats ambiguous 500 as idempotent when passage no longer exists", async () => {
      mockViking.deleteFile.mockRejectedValue(
        new Error("HTTP 500 from http://localhost:1933/api/v1/fs?uri=viking%3A%2F%2Fresources%2Fmyrepo%2Fpassages%2Fabc-123.txt"),
      );
      mockViking.listDirectory.mockResolvedValue([
        "viking://resources/myrepo/passages/other.txt",
      ]);

      await expect(store.deletePassage("myrepo", "abc-123")).resolves.toBeUndefined();
      expect(mockViking.listDirectory).toHaveBeenCalledWith("viking://resources/myrepo/passages/");
    });

    it("retries delete once when ambiguous 500 and target still exists", async () => {
      mockViking.deleteFile
        .mockRejectedValueOnce(new Error("HTTP 500 from http://localhost:1933/api/v1/fs?uri=viking%3A%2F%2Fresources%2Fmyrepo%2Fpassages%2Fabc-123.txt"))
        .mockResolvedValueOnce();
      mockViking.listDirectory.mockResolvedValue([
        "viking://resources/myrepo/passages/abc-123.txt",
      ]);

      await expect(store.deletePassage("myrepo", "abc-123")).resolves.toBeUndefined();
      expect(mockViking.deleteFile).toHaveBeenCalledTimes(2);
    });

    it("rethrows ambiguous 500 when passage is still listed", async () => {
      mockViking.deleteFile.mockRejectedValue(
        new Error("HTTP 500 from http://localhost:1933/api/v1/fs?uri=viking%3A%2F%2Fresources%2Fmyrepo%2Fpassages%2Fabc-123.txt"),
      );
      mockViking.listDirectory.mockResolvedValue([
        "viking://resources/myrepo/passages/abc-123.txt",
      ]);

      await expect(store.deletePassage("myrepo", "abc-123")).rejects.toThrow("HTTP 500");
    });

    it("rethrows non-ambiguous errors from deleteFile", async () => {
      mockViking.deleteFile.mockRejectedValue(new Error("HTTP 404 from x"));

      await expect(store.deletePassage("myrepo", "abc-123")).rejects.toThrow("HTTP 404");
      expect(mockViking.listDirectory).not.toHaveBeenCalled();
    });
  });

  describe("listPassages", () => {
    it("lists the directory, reads each file, returns passages with ids and text", async () => {
      mockViking.listDirectory.mockResolvedValue([
        "viking://resources/myrepo/passages/uuid-1.txt",
        "viking://resources/myrepo/passages/uuid-2.txt",
      ]);
      mockViking.readFile
        .mockResolvedValueOnce("passage one")
        .mockResolvedValueOnce("passage two");

      const passages = await store.listPassages("myrepo");

      expect(mockViking.listDirectory).toHaveBeenCalledWith("viking://resources/myrepo/passages/");
      expect(passages).toEqual([
        { id: "uuid-1", text: "passage one" },
        { id: "uuid-2", text: "passage two" },
      ]);
    });

    it("retries failed reads and returns recovered passages", async () => {
      mockViking.listDirectory.mockResolvedValue([
        "viking://resources/myrepo/passages/uuid-1.txt",
        "viking://resources/myrepo/passages/uuid-2.txt",
      ]);
      mockViking.readFile
        .mockRejectedValueOnce(new Error("HTTP 500 from /api/v1/content/read"))
        .mockResolvedValueOnce("passage two")
        .mockResolvedValueOnce("passage one");

      const passages = await store.listPassages("myrepo");

      expect(passages).toEqual([
        { id: "uuid-2", text: "passage two" },
        { id: "uuid-1", text: "passage one" },
      ]);
      expect(mockViking.readFile).toHaveBeenCalledTimes(3);
    });

    it("returns partial results when one read still fails after retry", async () => {
      mockViking.listDirectory.mockResolvedValue([
        "viking://resources/myrepo/passages/uuid-1.txt",
        "viking://resources/myrepo/passages/uuid-2.txt",
      ]);
      mockViking.readFile
        .mockResolvedValueOnce("passage one")
        .mockRejectedValueOnce(new Error("HTTP 500 from /api/v1/content/read"))
        .mockRejectedValueOnce(new Error("HTTP 500 from /api/v1/content/read"));

      const passages = await store.listPassages("myrepo");

      expect(passages).toEqual([{ id: "uuid-1", text: "passage one" }]);
    });

    it("throws when all reads fail", async () => {
      mockViking.listDirectory.mockResolvedValue([
        "viking://resources/myrepo/passages/uuid-1.txt",
        "viking://resources/myrepo/passages/uuid-2.txt",
      ]);
      mockViking.readFile.mockRejectedValue(new Error("HTTP 500 from /api/v1/content/read"));

      await expect(store.listPassages("myrepo")).rejects.toThrow("HTTP 500");
    });
  });

  describe("semanticSearch", () => {
    it("searches under the agent's passages URI and maps uris to passage ids", async () => {
      mockViking.semanticSearch.mockResolvedValue([
        { uri: "viking://resources/myrepo/passages/p-1.txt", text: "alpha", score: 0.9 },
        { uri: "viking://resources/myrepo/passages/p-2", text: "beta", score: 0.8 },
      ]);

      const results = await store.semanticSearch("myrepo", "auth flow", 10);

      expect(mockViking.semanticSearch).toHaveBeenCalledWith(
        "auth flow",
        "viking://resources/myrepo/passages/",
        10,
      );
      expect(results).toEqual([
        { id: "p-1", text: "alpha", score: 0.9 },
        { id: "p-2", text: "beta", score: 0.8 },
      ]);
    });
  });
});
