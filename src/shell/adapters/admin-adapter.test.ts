import { describe, it, expect, vi } from "vitest";
import { AdminAdapter } from "./admin-adapter.js";
import type { AgentProvider } from "../../ports/agent-provider.js";
import type { PassageStore } from "../../ports/passage-store.js";

function makeAdapter() {
  const provider = {
    getBlock: vi.fn(),
  };

  const store = {
    listAgents: vi.fn(),
    semanticSearch: vi.fn(),
  };

  const adapter = new AdminAdapter(
    provider as unknown as AgentProvider,
    store as unknown as PassageStore,
  );

  return { adapter, provider, store };
}

describe("AdminAdapter", () => {
  describe("listAgents", () => {
    it("maps store agent ids to agent summaries", async () => {
      const { adapter, store } = makeAdapter();
      store.listAgents.mockResolvedValue(["repo-a", "repo-b"]);

      const agents = await adapter.listAgents();

      expect(store.listAgents).toHaveBeenCalledWith();
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
    it("uses default limit and maps results to id/text pairs", async () => {
      const { adapter, store } = makeAdapter();
      store.semanticSearch.mockResolvedValue([
        { id: "p-1", text: "alpha", score: 0.9 },
        { id: "p-2", text: "beta", score: 0.8 },
      ]);

      const results = await adapter.searchPassages("repo", "auth flow");

      expect(store.semanticSearch).toHaveBeenCalledWith("repo", "auth flow", 10, undefined);
      expect(results).toEqual([
        { id: "p-1", text: "alpha" },
        { id: "p-2", text: "beta" },
      ]);
    });

    it("passes through explicit limit", async () => {
      const { adapter, store } = makeAdapter();
      store.semanticSearch.mockResolvedValue([]);

      await adapter.searchPassages("repo", "auth flow", 5);

      expect(store.semanticSearch).toHaveBeenCalledWith("repo", "auth flow", 5, undefined);
    });

    it("forwards pathPrefix to semanticSearch", async () => {
      const { adapter, store } = makeAdapter();
      store.semanticSearch.mockResolvedValue([]);

      await adapter.searchPassages("repo", "auth flow", 5, { pathPrefix: "src/auth" });

      expect(store.semanticSearch).toHaveBeenCalledWith("repo", "auth flow", 5, {
        pathPrefix: "src/auth",
      });
    });

    it("treats empty pathPrefix as undefined", async () => {
      const { adapter, store } = makeAdapter();
      store.semanticSearch.mockResolvedValue([]);

      await adapter.searchPassages("repo", "auth", 10, { pathPrefix: "" });

      expect(store.semanticSearch).toHaveBeenCalledWith("repo", "auth", 10, undefined);
    });
  });
});
