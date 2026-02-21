import { describe, it, expect, vi } from "vitest";
import { createRepoAgent, loadPassages } from "./agent-factory.js";
import type { RepoConfig, Config } from "../core/types.js";
import type { AgentProvider } from "./provider.js";
import { makeMockProvider as makeBase } from "./__test__/mock-provider.js";

function makeMockProvider(): AgentProvider & { _passageIds: string[] } {
  const passageIds: string[] = [];
  let passageCounter = 0;
  return {
    ...makeBase(),
    storePassage: vi.fn().mockImplementation(async () => {
      const id = `passage-${++passageCounter}`;
      passageIds.push(id);
      return id;
    }),
    _passageIds: passageIds,
  };
}

const testConfig: RepoConfig = {
  path: "/tmp/test-repo",
  description: "Test repo",
  extensions: [".ts"],
  ignoreDirs: ["node_modules"],
  tags: ["frontend", "mobile"],
  maxFileSizeKb: 50,
  memoryBlockLimit: 5000,
  bootstrapOnCreate: true,
};

const testLetta: Config["letta"] = {
  model: "openai/gpt-4.1",
  embedding: "openai/text-embedding-3-small",
};

describe("createRepoAgent", () => {
  it("creates an agent with correct params", async () => {
    const provider = makeMockProvider();
    const result = await createRepoAgent(provider, "my-app", testConfig, testLetta);
    expect(result.agentId).toBe("agent-abc");
    expect(result.repoName).toBe("my-app");

    const params = (provider.createAgent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(params.name).toBe("repo-expert-my-app");
    expect(params.model).toBe("openai/gpt-4.1");
    expect(params.embedding).toBe("openai/text-embedding-3-small");
    expect(params.tags).toEqual(["repo-expert", "frontend", "mobile"]);
    expect(params.description).toBe("Test repo");
    expect(params.memoryBlockLimit).toBe(5000);
  });
});

describe("loadPassages", () => {
  it("inserts chunks as passages and returns passage map", async () => {
    const provider = makeMockProvider();
    const chunks = [
      { text: "FILE: src/a.ts\ncontent a", sourcePath: "src/a.ts" },
      { text: "FILE: src/a.ts (continued)\nmore a", sourcePath: "src/a.ts" },
      { text: "FILE: src/b.ts\ncontent b", sourcePath: "src/b.ts" },
    ];

    const result = await loadPassages(provider, "agent-abc", chunks);
    expect(provider.storePassage as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(3);
    expect(result.passages["src/a.ts"]).toHaveLength(2);
    expect(result.passages["src/b.ts"]).toHaveLength(1);
    expect(result.failedChunks).toBe(0);
  });

  it("handles empty chunks array", async () => {
    const provider = makeMockProvider();
    const result = await loadPassages(provider, "agent-abc", []);
    expect(result.passages).toEqual({});
    expect(result.failedChunks).toBe(0);
    expect(provider.storePassage as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("counts failed chunks without throwing", async () => {
    const provider = makeMockProvider();
    let callCount = 0;
    (provider.storePassage as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount === 2) throw new Error("server error");
      return `passage-${callCount}`;
    });

    const chunks = [
      { text: "FILE: src/a.ts\ncontent a", sourcePath: "src/a.ts" },
      { text: "FILE: src/a.ts (continued)\nmore a", sourcePath: "src/a.ts" },
      { text: "FILE: src/b.ts\ncontent b", sourcePath: "src/b.ts" },
    ];

    const result = await loadPassages(provider, "agent-abc", chunks, 1);
    expect(result.failedChunks).toBe(1);
    // src/a.ts should have 1 passage (one succeeded, one failed)
    expect(result.passages["src/a.ts"]).toHaveLength(1);
    expect(result.passages["src/b.ts"]).toHaveLength(1);
  });

  it("calls onProgress callback during loading", async () => {
    const provider = makeMockProvider();
    const chunks = [
      { text: "FILE: src/a.ts\ncontent a", sourcePath: "src/a.ts" },
      { text: "FILE: src/b.ts\ncontent b", sourcePath: "src/b.ts" },
    ];

    const calls: Array<[number, number]> = [];
    await loadPassages(provider, "agent-abc", chunks, 1, (loaded, total) => {
      calls.push([loaded, total]);
    });

    expect(calls).toHaveLength(2);
    expect(calls.at(-1)).toEqual([2, 2]);
    // All calls should report total = 2
    for (const [, total] of calls) {
      expect(total).toBe(2);
    }
  });
});
