import { describe, it, expect, vi, beforeEach } from "vitest";
import { VikingHttpClient } from "./viking-http.js";

function makeResponse(
  status: number,
  body: unknown = null,
  ok?: boolean
): Response {
  return {
    ok: ok ?? (status >= 200 && status < 300),
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe("VikingHttpClient", () => {
  const BASE_URL = "http://localhost:1933";
  let client: VikingHttpClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    client = new VikingHttpClient(BASE_URL);
  });

  describe("mkdir", () => {
    it("posts to /api/v1/resources/mkdir with correct body", async () => {
      mockFetch.mockResolvedValue(makeResponse(200));
      await client.mkdir("viking://resources/myrepo/src");
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/resources/mkdir`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "Content-Type": "application/json" }),
          body: JSON.stringify({ uri: "viking://resources/myrepo/src" }),
        })
      );
    });

    it("throws on non-2xx response", async () => {
      mockFetch.mockResolvedValue(makeResponse(500));
      await expect(client.mkdir("viking://resources/myrepo/src")).rejects.toThrow(
        /500.*\/api\/v1\/resources\/mkdir/
      );
    });
  });

  describe("writeFile", () => {
    it("puts to /api/v1/files with correct body", async () => {
      mockFetch.mockResolvedValue(makeResponse(200));
      await client.writeFile("viking://resources/myrepo/src/a.ts", "content");
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/files`,
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            uri: "viking://resources/myrepo/src/a.ts",
            content: "content",
          }),
        })
      );
    });

    it("throws with status info on non-2xx", async () => {
      mockFetch.mockResolvedValue(makeResponse(422));
      await expect(
        client.writeFile("viking://resources/myrepo/src/a.ts", "content")
      ).rejects.toThrow(/422.*\/api\/v1\/files/);
    });
  });

  describe("readFile", () => {
    it("gets /api/v1/files?uri=... and returns content string", async () => {
      mockFetch.mockResolvedValue(makeResponse(200, "file content"));
      const result = await client.readFile("viking://resources/myrepo/src/a.ts");
      const encodedUri = encodeURIComponent("viking://resources/myrepo/src/a.ts");
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/files?uri=${encodedUri}`,
        expect.objectContaining({ method: "GET" })
      );
      expect(result).toBe("file content");
    });

    it("throws on non-2xx", async () => {
      mockFetch.mockResolvedValue(makeResponse(404));
      await expect(
        client.readFile("viking://resources/myrepo/src/missing.ts")
      ).rejects.toThrow(/404.*\/api\/v1\/files/);
    });
  });

  describe("deleteFile", () => {
    it("deletes /api/v1/files?uri=...", async () => {
      mockFetch.mockResolvedValue(makeResponse(204));
      await client.deleteFile("viking://resources/myrepo/src/a.ts");
      const encodedUri = encodeURIComponent("viking://resources/myrepo/src/a.ts");
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/files?uri=${encodedUri}`,
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("swallows 404", async () => {
      mockFetch.mockResolvedValue(makeResponse(404));
      await expect(
        client.deleteFile("viking://resources/myrepo/src/gone.ts")
      ).resolves.toBeUndefined();
    });

    it("throws on non-404 errors", async () => {
      mockFetch.mockResolvedValue(makeResponse(500));
      await expect(
        client.deleteFile("viking://resources/myrepo/src/a.ts")
      ).rejects.toThrow(/500.*\/api\/v1\/files/);
    });
  });

  describe("listDirectory", () => {
    it("gets /api/v1/directories?uri=... and returns string[]", async () => {
      mockFetch.mockResolvedValue(
        makeResponse(200, { children: ["viking://resources/myrepo/src/a.ts", "viking://resources/myrepo/src/b.ts"] })
      );
      const result = await client.listDirectory("viking://resources/myrepo/src");
      const encodedUri = encodeURIComponent("viking://resources/myrepo/src");
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/directories?uri=${encodedUri}`,
        expect.objectContaining({ method: "GET" })
      );
      expect(result).toEqual([
        "viking://resources/myrepo/src/a.ts",
        "viking://resources/myrepo/src/b.ts",
      ]);
    });

    it("throws on non-2xx", async () => {
      mockFetch.mockResolvedValue(makeResponse(500));
      await expect(
        client.listDirectory("viking://resources/myrepo/src")
      ).rejects.toThrow(/500.*\/api\/v1\/directories/);
    });
  });

  describe("deleteResource", () => {
    it("deletes /api/v1/resources?uri=...", async () => {
      mockFetch.mockResolvedValue(makeResponse(204));
      await client.deleteResource("viking://resources/myrepo");
      const encodedUri = encodeURIComponent("viking://resources/myrepo");
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/resources?uri=${encodedUri}`,
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("swallows 404", async () => {
      mockFetch.mockResolvedValue(makeResponse(404));
      await expect(
        client.deleteResource("viking://resources/myrepo")
      ).resolves.toBeUndefined();
    });

    it("throws on non-404 errors", async () => {
      mockFetch.mockResolvedValue(makeResponse(500));
      await expect(
        client.deleteResource("viking://resources/myrepo")
      ).rejects.toThrow(/500.*\/api\/v1\/resources/);
    });
  });

  describe("semanticSearch", () => {
    it("posts to /api/v1/search/find with correct body and returns results", async () => {
      const results = [
        { uri: "viking://resources/myrepo/src/a.ts", text: "some text", score: 0.9 },
      ];
      mockFetch.mockResolvedValue(makeResponse(200, results));
      const res = await client.semanticSearch("my query", "viking://resources/myrepo", 5);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/search/find`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            query: "my query",
            target_uri: "viking://resources/myrepo",
            top_k: 5,
          }),
        })
      );
      expect(res).toEqual(results);
    });

    it("defaults top_k to 10 when not provided", async () => {
      mockFetch.mockResolvedValue(makeResponse(200, []));
      await client.semanticSearch("query", "viking://resources/myrepo");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.top_k).toBe(10);
    });

    it("throws on non-2xx", async () => {
      mockFetch.mockResolvedValue(makeResponse(500));
      await expect(
        client.semanticSearch("query", "viking://resources/myrepo")
      ).rejects.toThrow(/500.*\/api\/v1\/search\/find/);
    });
  });

  describe("API key header", () => {
    it("sends Authorization header when apiKey is provided", async () => {
      const clientWithKey = new VikingHttpClient(BASE_URL, "my-secret-key");
      mockFetch.mockResolvedValue(makeResponse(200));
      await clientWithKey.mkdir("viking://resources/myrepo/src");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer my-secret-key",
          }),
        })
      );
    });

    it("does not send Authorization header when apiKey is not provided", async () => {
      mockFetch.mockResolvedValue(makeResponse(200));
      await client.mkdir("viking://resources/myrepo/src");
      const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(headers).not.toHaveProperty("Authorization");
    });
  });
});
