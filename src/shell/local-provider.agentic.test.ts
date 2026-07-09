import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalProvider } from "./local-provider.js";
import type { PassageStore } from "../ports/passage-store.js";
import type { BlockStorage } from "./block-storage.js";
import { createRepoAccess } from "./repo-tools.js";
import type { ToolHandler } from "./llm-client.js";

vi.mock("./llm-client.js", () => ({
  DEFAULT_LLM_BASE_URL: "http://localhost:11434/v1",
  toolCallingLoop: vi.fn().mockResolvedValue("mocked response"),
}));

import { toolCallingLoop } from "./llm-client.js";

function makeMockStore() {
  return {
    initAgent: vi.fn().mockResolvedValue(),
    deleteAgent: vi.fn().mockResolvedValue(),
    listAgents: vi.fn().mockResolvedValue([]),
    writePassage: vi.fn().mockResolvedValue(),
    writePassages: vi.fn().mockResolvedValue(),
    readPassage: vi.fn().mockResolvedValue(""),
    deletePassage: vi.fn().mockResolvedValue(),
    listPassages: vi.fn().mockResolvedValue([]),
    semanticSearch: vi.fn().mockResolvedValue([]),
  } satisfies Record<keyof PassageStore, ReturnType<typeof vi.fn>>;
}

function makeMockBlockStorage() {
  return {
    get: vi.fn().mockReturnValue(""),
    set: vi.fn(),
    init: vi.fn(),
    delete: vi.fn(),
  } satisfies BlockStorage;
}

const DEFAULT_MODEL = "openai/gpt-4o-mini";
const API_KEY = "test-api-key";

function stubMemoryBlocks(storage: ReturnType<typeof makeMockBlockStorage>): void {
  (storage.get as ReturnType<typeof vi.fn>).mockImplementation((_agentId: string, label: string) => {
    if (label === "persona") return "I am the persona";
    if (label === "architecture") return "Arch content";
    if (label === "conventions") return "Conv content";
    return "";
  });
}

function requireHandler(
  handlers: Partial<Record<string, ToolHandler>>,
  name: string,
): ToolHandler {
  const handler = handlers[name];
  if (handler === undefined) {
    throw new Error(`expected tool handler '${name}'`);
  }
  return handler;
}

describe("LocalProvider agentic tools", () => {
  let mockStore: ReturnType<typeof makeMockStore>;
  let mockBlockStorage: ReturnType<typeof makeMockBlockStorage>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore = makeMockStore();
    mockBlockStorage = makeMockBlockStorage();
  });

  it("exposes agentic tools and guidance when agenticTools is enabled", async () => {
    const provider = new LocalProvider(
      mockStore as unknown as PassageStore,
      DEFAULT_MODEL,
      mockBlockStorage,
      { apiKey: API_KEY, agenticTools: true },
    );
    stubMemoryBlocks(mockBlockStorage);

    await provider.sendMessage("myrepo", "hello");
    const callArgs = vi.mocked(toolCallingLoop).mock.calls[0][0];
    expect(callArgs.tools).toHaveLength(5);
    expect(callArgs.tools.map((t) => t.function.name)).toEqual([
      "grep_repo",
      "glob_files",
      "read_file",
      "archival_memory_search",
      "memory_replace",
    ]);
    expect(callArgs.systemPrompt).toContain("grep_repo");
  });

  it("agentic tools return a clear error when repoAccess is not configured", async () => {
    const provider = new LocalProvider(
      mockStore as unknown as PassageStore,
      DEFAULT_MODEL,
      mockBlockStorage,
      { apiKey: API_KEY, agenticTools: true },
    );
    stubMemoryBlocks(mockBlockStorage);
    await provider.sendMessage("myrepo", "hello");
    const handlers = vi.mocked(toolCallingLoop).mock.calls[0][0].toolHandlers;
    for (const name of ["grep_repo", "glob_files", "read_file"] as const) {
      const result = JSON.parse(await requireHandler(handlers, name)({ pattern: "x", path: "a.ts" })) as {
        error: string;
      };
      expect(result.error).toMatch(/not configured|config\.yaml/i);
    }
  });

  it("grep_repo / glob_files / read_file call repoAccess when configured", async () => {
    const grep = vi.fn().mockReturnValue({ stdout: "src/a.ts:1:hit", exitCode: 0 });
    const fakeFs = {
      readFile: vi.fn().mockResolvedValue("file body"),
      writeFile: vi.fn(),
      stat: vi.fn().mockResolvedValue({ size: 100, isDirectory: () => false }),
      access: vi.fn(),
      rename: vi.fn(),
      copyFile: vi.fn(),
      glob: vi.fn().mockResolvedValue(["src/a.ts"]),
      watch: vi.fn(),
    };
    const repoAccess = createRepoAccess(
      {
        myrepo: {
          path: "/repo",
          description: "test",
          extensions: [".ts"],
          ignoreDirs: ["node_modules"],
        },
      },
      { fs: fakeFs, grep },
    );
    const provider = new LocalProvider(
      mockStore as unknown as PassageStore,
      DEFAULT_MODEL,
      mockBlockStorage,
      { apiKey: API_KEY, agenticTools: true, repoAccess },
    );
    stubMemoryBlocks(mockBlockStorage);

    await provider.sendMessage("myrepo", "hello");
    const handlers = vi.mocked(toolCallingLoop).mock.calls[0][0].toolHandlers;

    const grepResult = JSON.parse(await requireHandler(handlers, "grep_repo")({ pattern: "hit" })) as {
      matches: string;
    };
    expect(grep).toHaveBeenCalled();
    expect(grepResult.matches).toContain("hit");

    const globResult = JSON.parse(
      await requireHandler(handlers, "glob_files")({ pattern: "**/*.ts" }),
    ) as { files: string[] };
    expect(fakeFs.glob).toHaveBeenCalled();
    expect(globResult.files).toEqual(["src/a.ts"]);

    const readResult = JSON.parse(await requireHandler(handlers, "read_file")({ path: "src/a.ts" })) as {
      content: string;
    };
    expect(fakeFs.readFile).toHaveBeenCalled();
    expect(readResult.content).toBe("file body");
  });
});
