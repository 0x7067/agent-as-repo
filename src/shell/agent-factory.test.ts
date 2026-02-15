import { describe, it, expect, vi } from "vitest";
import { createRepoAgent, loadPassages } from "./agent-factory.js";
import type { RepoConfig, Config } from "../core/types.js";

function makeMockClient() {
  const passageIds: string[] = [];
  let passageCounter = 0;
  return {
    agents: {
      create: vi.fn().mockResolvedValue({ id: "agent-abc" }),
      passages: {
        create: vi.fn().mockImplementation(async () => {
          const id = `passage-${++passageCounter}`;
          passageIds.push(id);
          return [{ id }];
        }),
      },
      messages: {
        create: vi.fn().mockResolvedValue({
          messages: [{ message_type: "assistant_message", content: "Done." }],
        }),
      },
    },
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
    const client = makeMockClient();
    const result = await createRepoAgent(client as any, "my-app", testConfig, testLetta);
    expect(result.agentId).toBe("agent-abc");
    expect(result.repoName).toBe("my-app");

    const createCall = client.agents.create.mock.calls[0][0];
    expect(createCall.name).toBe("repo-expert-my-app");
    expect(createCall.model).toBe("openai/gpt-4.1");
    expect(createCall.embedding).toBe("openai/text-embedding-3-small");
    expect(createCall.tools).toContain("archival_memory_search");
    expect(createCall.tags).toEqual(["repo-expert", "frontend", "mobile"]);
  });

  it("creates 3 memory blocks: persona, architecture, conventions", async () => {
    const client = makeMockClient();
    await createRepoAgent(client as any, "my-app", testConfig, testLetta);

    const createCall = client.agents.create.mock.calls[0][0];
    const labels = createCall.memory_blocks.map((b: any) => b.label);
    expect(labels).toEqual(["persona", "architecture", "conventions"]);
  });

  it("sets memory block limits from config", async () => {
    const client = makeMockClient();
    await createRepoAgent(client as any, "my-app", testConfig, testLetta);

    const createCall = client.agents.create.mock.calls[0][0];
    for (const block of createCall.memory_blocks) {
      expect(block.limit).toBe(5000);
    }
  });
});

describe("loadPassages", () => {
  it("inserts chunks as passages and returns passage map", async () => {
    const client = makeMockClient();
    const chunks = [
      { text: "FILE: src/a.ts\ncontent a", sourcePath: "src/a.ts" },
      { text: "FILE: src/a.ts (continued)\nmore a", sourcePath: "src/a.ts" },
      { text: "FILE: src/b.ts\ncontent b", sourcePath: "src/b.ts" },
    ];

    const passageMap = await loadPassages(client as any, "agent-abc", chunks);
    expect(client.agents.passages.create).toHaveBeenCalledTimes(3);
    expect(passageMap["src/a.ts"]).toHaveLength(2);
    expect(passageMap["src/b.ts"]).toHaveLength(1);
  });

  it("handles empty chunks array", async () => {
    const client = makeMockClient();
    const passageMap = await loadPassages(client as any, "agent-abc", []);
    expect(passageMap).toEqual({});
    expect(client.agents.passages.create).not.toHaveBeenCalled();
  });
});
