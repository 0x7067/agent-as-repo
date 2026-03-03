import { describe, it, expect, vi } from "vitest";
import { VikingAdminAdapter } from "./viking-admin-adapter.js";
import type { VikingProvider } from "../viking-provider.js";
import type { VikingHttpClient } from "../viking-http.js";

function makeAdapter() {
  const provider = {
    getBlock: vi.fn(),
  };

  const viking = {
    listDirectory: vi.fn(),
    semanticSearch: vi.fn(),
  };

  const adapter = new VikingAdminAdapter(
    provider as unknown as VikingProvider,
    viking as unknown as VikingHttpClient,
  );

  return { adapter, provider, viking };
}

describe("VikingAdminAdapter", () => {
  describe("listAgents", () => {
    it("maps resource URIs to agent summaries", async () => {
      const { adapter, viking } = makeAdapter();
      viking.listDirectory.mockResolvedValue([
        "viking://resources/repo-a/",
        "viking://resources/repo-b/",
      ]);

      const agents = await adapter.listAgents();

      expect(viking.listDirectory).toHaveBeenCalledWith("viking://resources/");
      expect(agents).toEqual([
        { id: "repo-a", name: "repo-a" },
        { id: "repo-b", name: "repo-b" },
      ]);
    });
  });

  describe("getAgent", () => {
    it("returns id, name, and blocks from getCoreMemory", async () => {
      const { adapter } = makeAdapter();
      const blocks = [{ label: "persona", value: "I know the repo.", limit: 5000 }];
      const spy = vi.spyOn(adapter, "getCoreMemory").mockResolvedValue(blocks);

      const agent = await adapter.getAgent("my-repo");

      expect(spy).toHaveBeenCalledWith("my-repo");
      expect(agent).toEqual({
        id: "my-repo",
        name: "my-repo",
        blocks,
      });
    });
  });

  describe("getCoreMemory", () => {
    it("returns existing blocks and skips missing labels", async () => {
      const { adapter, provider } = makeAdapter();
      provider.getBlock.mockImplementation((_agentId: string, label: string) => {
        if (label === "architecture") {
          return Promise.reject(new Error("not found"));
        }

        return Promise.resolve({
          value: `${label} value`,
          limit: 5000,
        });
      });

      const blocks = await adapter.getCoreMemory("repo-x");

      expect(provider.getBlock).toHaveBeenCalledTimes(3);
      expect(provider.getBlock).toHaveBeenNthCalledWith(1, "repo-x", "persona");
      expect(provider.getBlock).toHaveBeenNthCalledWith(2, "repo-x", "architecture");
      expect(provider.getBlock).toHaveBeenNthCalledWith(3, "repo-x", "conventions");
      expect(blocks).toEqual([
        { label: "persona", value: "persona value", limit: 5000 },
        { label: "conventions", value: "conventions value", limit: 5000 },
      ]);
    });
  });

  describe("searchPassages", () => {
    it("uses default limit and maps uri filenames to passage ids", async () => {
      const { adapter, viking } = makeAdapter();
      viking.semanticSearch.mockResolvedValue([
        { uri: "viking://resources/repo/passages/p-1.txt", text: "alpha", score: 0.9 },
        { uri: "viking://resources/repo/passages/p-2", text: "beta", score: 0.8 },
      ]);

      const results = await adapter.searchPassages("repo", "auth flow");

      expect(viking.semanticSearch).toHaveBeenCalledWith(
        "auth flow",
        "viking://resources/repo/passages/",
        10,
      );
      expect(results).toEqual([
        { id: "p-1", text: "alpha" },
        { id: "p-2", text: "beta" },
      ]);
    });

    it("passes through explicit limit", async () => {
      const { adapter, viking } = makeAdapter();
      viking.semanticSearch.mockResolvedValue([]);

      await adapter.searchPassages("repo", "auth flow", 5);

      expect(viking.semanticSearch).toHaveBeenCalledWith(
        "auth flow",
        "viking://resources/repo/passages/",
        5,
      );
    });
  });
});
