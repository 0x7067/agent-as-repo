import { describe, it, expect, vi } from "vitest";
import { createRepoAgent, loadPassages } from "./agent-factory.js";
import type { RepoConfig, Config } from "../core/types.js";
import type { AgentProvider } from "./provider.js";

function makeMockProvider(): AgentProvider & { _passageIds: string[] } {
  const passageIds: string[] = [];
  let passageCounter = 0;
  return {
    createAgent: vi.fn().mockResolvedValue({ agentId: "agent-abc" }),
    deleteAgent: vi.fn().mockResolvedValue(undefined),
    storePassage: vi.fn().mockImplementation(async () => {
      const id = `passage-${++passageCounter}`;
      passageIds.push(id);
      return id;
    }),
    sendMessage: vi.fn().mockResolvedValue("Done."),
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

    const passageMap = await loadPassages(provider, "agent-abc", chunks);
    expect(provider.storePassage as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(3);
    expect(passageMap["src/a.ts"]).toHaveLength(2);
    expect(passageMap["src/b.ts"]).toHaveLength(1);
  });

  it("handles empty chunks array", async () => {
    const provider = makeMockProvider();
    const passageMap = await loadPassages(provider, "agent-abc", []);
    expect(passageMap).toEqual({});
    expect(provider.storePassage as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});
