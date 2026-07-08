import { describe, it, expect, vi } from "vitest";
import { createRepoAgent, loadPassages } from "./agent-factory.js";
import type { RepoConfig } from "../core/types.js";
import type { AgentProvider, CreateAgentParams } from "../ports/agent-provider.js";
import { makeMockProvider as makeBase } from "./__test__/mock-provider.js";

const FILE_A = "src/a.ts";
const FILE_B = "src/b.ts";
const CHUNK_A = "FILE: src/a.ts\ncontent a";
const CHUNK_A_CONTINUED = "FILE: src/a.ts (continued)\nmore a";
const CHUNK_B = "FILE: src/b.ts\ncontent b";

function makeMockProvider(): AgentProvider & { _passageIds: string[] } {
  const passageIds: string[] = [];
  let passageCounter = 0;
  return {
    ...makeBase(),
    storePassage: vi.fn().mockImplementation(() => {
      const id = `passage-${String(++passageCounter)}`;
      passageIds.push(id);
      return Promise.resolve(id);
    }),
    _passageIds: passageIds,
  };
}

function makeBatchingProvider(overrides?: Partial<AgentProvider>): AgentProvider {
  return {
    ...makeBase(),
    storePassages: vi.fn().mockImplementation((_agentId: string, texts: string[]) =>
      Promise.resolve(texts.map((_, i) => `batch-passage-${String(i)}`)),
    ),
    ...overrides,
  };
}

const testConfig: RepoConfig = {
  path: "/repo/test-repo",
  description: "Test repo",
  extensions: [".ts"],
  ignoreDirs: ["node_modules"],
};

const testModelOptions = {
  model: "qwen3-coder:30b",
};

describe("createRepoAgent", () => {
  it("creates an agent with correct params", async () => {
    const provider = makeMockProvider();
    const result = await createRepoAgent(provider, "my-app", testConfig, testModelOptions);
    expect(result.agentId).toBe("agent-abc");
    expect(result.repoName).toBe("my-app");

    const [params] = (provider.createAgent as ReturnType<typeof vi.fn>).mock.calls[0] as [CreateAgentParams];
    expect(params.name).toBe("repo-expert-my-app");
    expect(params.model).toBe("qwen3-coder:30b");
    expect(params.description).toBe("Test repo");
  });
});

describe("loadPassages", () => {
  it("keeps the provider's `this` binding when calling storePassages (regression: LocalProvider crashed on this.store)", async () => {
    // LocalProvider.storePassages is a class method that reads this.store —
    // extracting it as a bare function loses `this` and crashes at runtime.
    // A mock arrow function can't catch that, so use a prototype method.
    class ThisReliantProvider {
      stored: string[] = [];
      storePassages(_agentId: string, texts: string[]): Promise<string[]> {
        return Promise.resolve(
          texts.map((text) => {
            this.stored.push(text);
            return `id-${String(this.stored.length)}`;
          }),
        );
      }
    }
    const inner = new ThisReliantProvider();
    const provider = Object.assign(inner, makeBase()) as unknown as AgentProvider & ThisReliantProvider;

    const chunks = [{ text: CHUNK_A, sourcePath: FILE_A }];
    const result = await loadPassages(provider, "agent-abc", chunks);

    expect(result.failedChunks).toBe(0);
    expect(result.passages[FILE_A]).toEqual(["id-1"]);
    expect(provider.stored).toEqual([CHUNK_A]);
  });

  it("inserts chunks as passages and returns passage map", async () => {
    const provider = makeMockProvider();
    const chunks = [
      { text: CHUNK_A, sourcePath: FILE_A },
      { text: CHUNK_A_CONTINUED, sourcePath: FILE_A },
      { text: CHUNK_B, sourcePath: FILE_B },
    ];

    const result = await loadPassages(provider, "agent-abc", chunks);
    expect(provider.storePassage as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(3);
    expect(result.passages[FILE_A]).toHaveLength(2);
    expect(result.passages[FILE_B]).toHaveLength(1);
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
    (provider.storePassage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount === 2) throw new Error("server error");
      return `passage-${String(callCount)}`;
    });

    const chunks = [
      { text: CHUNK_A, sourcePath: FILE_A },
      { text: CHUNK_A_CONTINUED, sourcePath: FILE_A },
      { text: CHUNK_B, sourcePath: FILE_B },
    ];

    const result = await loadPassages(provider, "agent-abc", chunks, 1);
    expect(result.failedChunks).toBe(1);
    // src/a.ts should have 1 passage (one succeeded, one failed)
    expect(result.passages[FILE_A]).toHaveLength(1);
    expect(result.passages[FILE_B]).toHaveLength(1);
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

  describe("batched storePassages path", () => {
    it("uses provider.storePassages in a single batch call instead of per-chunk storePassage", async () => {
      const provider = makeBatchingProvider();
      const chunks = [
        { text: CHUNK_A, sourcePath: FILE_A },
        { text: CHUNK_A_CONTINUED, sourcePath: FILE_A },
        { text: CHUNK_B, sourcePath: FILE_B },
      ];

      const result = await loadPassages(provider, "agent-abc", chunks);

      // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock passed to expect, never invoked
      expect(provider.storePassages).toHaveBeenCalledTimes(1);
      expect(provider.storePassage).not.toHaveBeenCalled();
      expect(result.passages[FILE_A]).toHaveLength(2);
      expect(result.passages[FILE_B]).toHaveLength(1);
      expect(result.failedChunks).toBe(0);
    });

    it("splits large chunk lists into multiple storePassages calls of at most 32 chunks each", async () => {
      let callCount = 0;
      const provider = makeBatchingProvider({
        storePassages: vi.fn().mockImplementation((_agentId: string, texts: string[]) => {
          callCount++;
          return Promise.resolve(texts.map((_, i) => `p-${String(callCount)}-${String(i)}`));
        }),
      });
      const chunks = Array.from({ length: 70 }, (_, i) => ({
        text: `chunk ${String(i)}`,
        sourcePath: `src/f${String(i)}.ts`,
      }));

      const result = await loadPassages(provider, "agent-abc", chunks);

      // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock inspected via its mock property, never invoked unbound
      const storePassagesMock = provider.storePassages as ReturnType<typeof vi.fn>;
      expect(storePassagesMock).toHaveBeenCalledTimes(3);
      expect((storePassagesMock.mock.calls[0] as [string, string[]])[1]).toHaveLength(32);
      expect((storePassagesMock.mock.calls[1] as [string, string[]])[1]).toHaveLength(32);
      expect((storePassagesMock.mock.calls[2] as [string, string[]])[1]).toHaveLength(6);
      expect(Object.keys(result.passages)).toHaveLength(70);
      expect(result.failedChunks).toBe(0);
    });

    it("fires onProgress per batch, reaching the full total", async () => {
      const provider = makeBatchingProvider();
      const chunks = Array.from({ length: 40 }, (_, i) => ({
        text: `chunk ${String(i)}`,
        sourcePath: `src/f${String(i)}.ts`,
      }));

      const calls: Array<[number, number]> = [];
      await loadPassages(provider, "agent-abc", chunks, 20, (loaded, total) => {
        calls.push([loaded, total]);
      });

      expect(calls.length).toBeGreaterThan(0);
      expect(calls.at(-1)).toEqual([40, 40]);
      for (const [, total] of calls) expect(total).toBe(40);
    });

    it("counts an entire failed batch as failed chunks without throwing", async () => {
      let callCount = 0;
      const provider = makeBatchingProvider({
        storePassages: vi.fn().mockImplementation((_agentId: string, texts: string[]) => {
          callCount++;
          if (callCount === 1) return Promise.reject(new Error("embed endpoint down"));
          return Promise.resolve(texts.map((_, i) => `p-${String(callCount)}-${String(i)}`));
        }),
      });
      const chunks = Array.from({ length: 40 }, (_, i) => ({
        text: `chunk ${String(i)}`,
        sourcePath: `src/f${String(i)}.ts`,
      }));

      // concurrency 1 makes batch execution order deterministic: batch 1
      // (32 chunks) fails first, batch 2 (8 chunks) succeeds after.
      const result = await loadPassages(provider, "agent-abc", chunks, 1);

      expect(result.failedChunks).toBe(32);
      expect(Object.keys(result.passages)).toHaveLength(8);
    });

    it("falls back to per-chunk storePassage when provider has no storePassages", async () => {
      const provider = makeMockProvider();
      const chunks = [
        { text: CHUNK_A, sourcePath: FILE_A },
        { text: CHUNK_B, sourcePath: FILE_B },
      ];

      const result = await loadPassages(provider, "agent-abc", chunks);

      expect(provider.storePassage).toHaveBeenCalledTimes(2);
      expect(result.passages[FILE_A]).toHaveLength(1);
      expect(result.passages[FILE_B]).toHaveLength(1);
    });
  });
});
