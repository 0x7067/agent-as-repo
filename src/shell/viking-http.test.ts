import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("mkdir", () => {
    it("posts to /api/v1/fs/mkdir with correct body", async () => {
      mockFetch.mockResolvedValue(makeResponse(200, { status: "ok", result: { uri: "viking://resources/myrepo/src" } }));
      await client.mkdir("viking://resources/myrepo/src");
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/fs/mkdir`,
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
        /500.*\/api\/v1\/fs\/mkdir/
      );
    });
  });

  describe("writeFile", () => {
    it("uploads via temp_upload then calls add_resource with target", async () => {
      const tempPath = "/tmp/openviking/upload_abc.txt";
      mockFetch
        .mockResolvedValueOnce(makeResponse(200, { status: "ok", result: { temp_path: tempPath } }))
        .mockResolvedValueOnce(makeResponse(200, { status: "ok", result: {} }));

      await client.writeFile("viking://resources/myrepo/src/a.ts", "content");

      // First call: temp_upload with FormData
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        `${BASE_URL}/api/v1/resources/temp_upload`,
        expect.objectContaining({ method: "POST" })
      );
      const firstCallBody = mockFetch.mock.calls[0][1].body;
      expect(firstCallBody).toBeInstanceOf(FormData);

      // Second call: add_resource with temp_path and target
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        `${BASE_URL}/api/v1/resources`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "Content-Type": "application/json" }),
          body: JSON.stringify({ temp_path: tempPath, target: "viking://resources/myrepo/src/a.ts", wait: true, strict: false }),
        })
      );
    });

    it("throws if temp_upload fails", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(422));
      await expect(
        client.writeFile("viking://resources/myrepo/src/a.ts", "content")
      ).rejects.toThrow(/422.*\/api\/v1\/resources\/temp_upload/);
    });

    it("throws if add_resource fails", async () => {
      const tempPath = "/tmp/openviking/upload_abc.txt";
      mockFetch
        .mockResolvedValueOnce(makeResponse(200, { status: "ok", result: { temp_path: tempPath } }))
        .mockResolvedValueOnce(makeResponse(500))
        .mockResolvedValueOnce(makeResponse(500))
        .mockResolvedValueOnce(makeResponse(500));
      await expect(
        client.writeFile("viking://resources/myrepo/src/a.ts", "content")
      ).rejects.toThrow(/500.*\/api\/v1\/resources/);
    });
  });

  describe("readFile", () => {
    it("gets /api/v1/content/read?uri=... and returns content string from result field", async () => {
      mockFetch.mockResolvedValue(makeResponse(200, { status: "ok", result: "file content" }));
      const result = await client.readFile("viking://resources/myrepo/src/a.ts");
      const encodedUri = encodeURIComponent("viking://resources/myrepo/src/a.ts");
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/content/read?uri=${encodedUri}`,
        expect.objectContaining({ method: "GET" })
      );
      expect(result).toBe("file content");
    });

    it("retries on transient 5xx response and eventually succeeds", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(500))
        .mockResolvedValueOnce(makeResponse(200, { status: "ok", result: "file content" }));

      const result = await client.readFile("viking://resources/myrepo/src/a.ts");

      expect(result).toBe("file content");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws on non-2xx", async () => {
      mockFetch.mockResolvedValue(makeResponse(404));
      await expect(
        client.readFile("viking://resources/myrepo/src/missing.ts")
      ).rejects.toThrow(/404.*\/api\/v1\/content\/read/);
    });
  });

  describe("deleteFile", () => {
    it("deletes /api/v1/fs?uri=...", async () => {
      mockFetch.mockResolvedValue(makeResponse(200, { status: "ok", result: {} }));
      await client.deleteFile("viking://resources/myrepo/src/a.ts");
      const encodedUri = encodeURIComponent("viking://resources/myrepo/src/a.ts");
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/fs?uri=${encodedUri}`,
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("retries transient errors before returning 404 as idempotent success", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(500))
        .mockResolvedValueOnce(makeResponse(404));

      await expect(
        client.deleteFile("viking://resources/myrepo/src/gone.ts")
      ).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledTimes(2);
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
      ).rejects.toThrow(/500.*\/api\/v1\/fs/);
    });
  });

  describe("listDirectory", () => {
    it("gets /api/v1/fs/ls?uri=...&simple=true and returns string[]", async () => {
      mockFetch.mockResolvedValue(
        makeResponse(200, { status: "ok", result: ["viking://resources/myrepo/src/a.ts", "viking://resources/myrepo/src/b.ts"] })
      );
      const result = await client.listDirectory("viking://resources/myrepo/src");
      const encodedUri = encodeURIComponent("viking://resources/myrepo/src");
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/fs/ls?uri=${encodedUri}&simple=true`,
        expect.objectContaining({ method: "GET" })
      );
      expect(result).toEqual([
        "viking://resources/myrepo/src/a.ts",
        "viking://resources/myrepo/src/b.ts",
      ]);
    });

    it("retries on transient 429 response and succeeds", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(429))
        .mockResolvedValueOnce(makeResponse(200, { status: "ok", result: ["viking://resources/myrepo/src/a.ts"] }));

      const result = await client.listDirectory("viking://resources/myrepo/src");

      expect(result).toEqual(["viking://resources/myrepo/src/a.ts"]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws on non-2xx", async () => {
      mockFetch.mockResolvedValue(makeResponse(500));
      await expect(
        client.listDirectory("viking://resources/myrepo/src")
      ).rejects.toThrow(/500.*\/api\/v1\/fs\/ls/);
    });
  });

  describe("deleteResource", () => {
    it("deletes /api/v1/fs?uri=...&recursive=true", async () => {
      mockFetch.mockResolvedValue(makeResponse(200, { status: "ok", result: {} }));
      await client.deleteResource("viking://resources/myrepo");
      const encodedUri = encodeURIComponent("viking://resources/myrepo");
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/fs?uri=${encodedUri}&recursive=true`,
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
      ).rejects.toThrow(/500.*\/api\/v1\/fs/);
    });
  });

  describe("semanticSearch", () => {
    it("posts to /api/v1/search/find and fetches content for each result URI", async () => {
      const apiResponse = {
        status: "ok",
        result: {
          memories: [],
          resources: [
            { uri: "viking://resources/myrepo/src/a.ts", abstract: "", score: 0.9 },
          ],
          skills: [],
        },
      };
      const encodedUri = encodeURIComponent("viking://resources/myrepo/src/a.ts");
      mockFetch
        .mockResolvedValueOnce(makeResponse(200, apiResponse))
        .mockResolvedValueOnce(makeResponse(200, { status: "ok", result: "actual file content" }));

      const res = await client.semanticSearch("my query", "viking://resources/myrepo", 5);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        `${BASE_URL}/api/v1/search/find`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            query: "my query",
            target_uri: "viking://resources/myrepo",
            limit: 5,
          }),
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        `${BASE_URL}/api/v1/content/read?uri=${encodedUri}`,
        expect.objectContaining({ method: "GET" })
      );
      expect(res).toEqual([
        { uri: "viking://resources/myrepo/src/a.ts", text: "actual file content", score: 0.9 },
      ]);
    });

    it("defaults limit to 10 when not provided", async () => {
      mockFetch.mockResolvedValue(makeResponse(200, { status: "ok", result: { memories: [], resources: [], skills: [] } }));
      await client.semanticSearch("query", "viking://resources/myrepo");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.limit).toBe(10);
    });

    it("returns empty array when no resources", async () => {
      mockFetch.mockResolvedValue(makeResponse(200, { status: "ok", result: { memories: [], resources: [], skills: [] } }));
      const res = await client.semanticSearch("query", "viking://resources/myrepo");
      expect(res).toEqual([]);
    });

    it("throws on non-2xx search response", async () => {
      mockFetch.mockResolvedValue(makeResponse(500));
      await expect(
        client.semanticSearch("query", "viking://resources/myrepo")
      ).rejects.toThrow(/500.*\/api\/v1\/search\/find/);
    });

    it("throws if content fetch fails for a result", async () => {
      const apiResponse = {
        status: "ok",
        result: {
          resources: [{ uri: "viking://resources/myrepo/src/a.ts", abstract: "", score: 0.9 }],
        },
      };
      mockFetch
        .mockResolvedValueOnce(makeResponse(200, apiResponse))
        .mockResolvedValueOnce(makeResponse(500))
        .mockResolvedValueOnce(makeResponse(500))
        .mockResolvedValueOnce(makeResponse(500));
      await expect(
        client.semanticSearch("query", "viking://resources/myrepo")
      ).rejects.toThrow(/500.*\/api\/v1\/content\/read/);
    });
  });

  describe("API key header", () => {
    it("sends Authorization header when apiKey is provided", async () => {
      const clientWithKey = new VikingHttpClient(BASE_URL, "my-secret-key");
      mockFetch.mockResolvedValue(makeResponse(200, { status: "ok", result: {} }));
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
      mockFetch.mockResolvedValue(makeResponse(200, { status: "ok", result: {} }));
      await client.mkdir("viking://resources/myrepo/src");
      const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(headers).not.toHaveProperty("Authorization");
    });

    it("retries on network errors before succeeding", async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(makeResponse(200, { status: "ok", result: {} }));

      await client.mkdir("viking://resources/myrepo/src");

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("circuit breaker", () => {
    it("opens for fs operations after repeated retryable failures and fails fast", async () => {
      const clientWithBreaker = new VikingHttpClient(BASE_URL, undefined, {
        maxRetries: 0,
        breakerFailureThreshold: 2,
        breakerWindowMs: 10_000,
        breakerCooldownMs: 5_000,
      });

      mockFetch
        .mockResolvedValueOnce(makeResponse(500))
        .mockResolvedValueOnce(makeResponse(500));

      await expect(clientWithBreaker.deleteResource("viking://resources/myrepo")).rejects.toThrow(/500/);
      await expect(clientWithBreaker.deleteResource("viking://resources/myrepo")).rejects.toThrow(/500/);

      await expect(clientWithBreaker.deleteResource("viking://resources/myrepo")).rejects.toThrow(
        /Circuit open for Viking fs operations/,
      );
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("allows requests again after cooldown window", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

      const clientWithBreaker = new VikingHttpClient(BASE_URL, undefined, {
        maxRetries: 0,
        breakerFailureThreshold: 1,
        breakerWindowMs: 10_000,
        breakerCooldownMs: 1_000,
      });

      mockFetch.mockResolvedValueOnce(makeResponse(500));
      await expect(clientWithBreaker.listDirectory("viking://resources/myrepo")).rejects.toThrow(/500/);

      await expect(clientWithBreaker.listDirectory("viking://resources/myrepo")).rejects.toThrow(
        /Circuit open for Viking fs operations/,
      );

      vi.advanceTimersByTime(1_001);
      mockFetch.mockResolvedValueOnce(makeResponse(200, { status: "ok", result: [] }));
      await expect(clientWithBreaker.listDirectory("viking://resources/myrepo")).resolves.toEqual([]);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("keeps fs and content circuit domains isolated", async () => {
      const clientWithBreaker = new VikingHttpClient(BASE_URL, undefined, {
        maxRetries: 0,
        breakerFailureThreshold: 1,
        breakerWindowMs: 10_000,
        breakerCooldownMs: 5_000,
      });

      mockFetch
        .mockResolvedValueOnce(makeResponse(500))
        .mockResolvedValueOnce(makeResponse(200, { status: "ok", result: { uri: "viking://resources/myrepo/src" } }));

      await expect(clientWithBreaker.readFile("viking://resources/myrepo/src/a.ts")).rejects.toThrow(/500/);
      await expect(clientWithBreaker.mkdir("viking://resources/myrepo/src")).resolves.toBeUndefined();
      await expect(clientWithBreaker.readFile("viking://resources/myrepo/src/a.ts")).rejects.toThrow(
        /Circuit open for Viking content operations/,
      );

      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        `${BASE_URL}/api/v1/fs/mkdir`,
        expect.objectContaining({ method: "POST" }),
      );
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
