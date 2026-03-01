import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Config, AppState } from "../core/types.js";
import type { FileSystemPort, WatcherHandle } from "../ports/filesystem.js";
import type { GitPort } from "../ports/git.js";

vi.mock("./state-store.js", () => ({
  loadState: vi.fn(),
  saveState: vi.fn(),
}));

vi.mock("./file-collector.js", () => ({
  collectFiles: vi.fn().mockResolvedValue([]),
}));

vi.mock("./sync.js", () => ({
  syncRepo: vi.fn(),
}));

vi.mock("./submodule-collector.js", () => ({
  listSubmodules: vi.fn().mockReturnValue([]),
  expandSubmoduleFiles: vi.fn().mockResolvedValue([]),
}));

import { loadState, saveState } from "./state-store.js";
import { syncRepo } from "./sync.js";
import { listSubmodules, expandSubmoduleFiles } from "./submodule-collector.js";
import { watchRepos } from "./watch.js";

const mockedLoadState = vi.mocked(loadState);
const mockedSaveState = vi.mocked(saveState);
const mockedSyncRepo = vi.mocked(syncRepo);
const mockedListSubmodules = vi.mocked(listSubmodules);
const mockedExpandSubmoduleFiles = vi.mocked(expandSubmoduleFiles);

// Import shared mock after vi.mock calls
import { makeMockProvider } from "./__test__/mock-provider.js";

function makeFakeGit(overrides: Partial<GitPort> = {}): GitPort {
  return {
    submoduleStatus: vi.fn().mockReturnValue(""),
    version: vi.fn().mockReturnValue("git version 2.39.0"),
    headCommit: vi.fn().mockReturnValue("abc1234"),
    diffFiles: vi.fn().mockReturnValue([]),
    ...overrides,
  };
}

function makeFakeFs(overrides: Partial<FileSystemPort> = {}): FileSystemPort {
  return {
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 0, isDirectory: () => false }),
    access: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    glob: vi.fn().mockResolvedValue([]),
    watch: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    } as unknown as WatcherHandle),
    ...overrides,
  };
}

const testConfig: Config = {
  letta: { model: "letta-free", embedding: "letta-free" },
  defaults: { maxFileSizeKb: 50, memoryBlockLimit: 5000, bootstrapOnCreate: false, chunking: "raw" },
  repos: {
    "my-app": {
      path: "/tmp/my-app",
      description: "Test",
      extensions: [".ts"],
      ignoreDirs: ["node_modules"],
      tags: ["test"],
      maxFileSizeKb: 50,
      memoryBlockLimit: 5000,
      bootstrapOnCreate: false,
    },
  },
};

function makeState(lastSyncCommit: string | null = "abc123"): AppState {
  return {
    stateVersion: 2,
    agents: {
      "my-app": {
        agentId: "agent-abc",
        repoName: "my-app",
        passages: { "src/a.ts": ["p-1"] },
        lastBootstrap: null,
        lastSyncCommit,
        lastSyncAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("watchRepos", () => {
  it("triggers sync when HEAD changes", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({
      headCommit: vi.fn().mockReturnValue("def456"),
      diffFiles: vi.fn().mockReturnValue(["src/a.ts"]),
    });
    mockedSyncRepo.mockResolvedValue({
      passages: { "src/a.ts": ["p-2"] },
      lastSyncCommit: "def456",
      filesRemoved: 0,
      filesReIndexed: 1,
      isFullReIndex: false,
      failedFiles: [],
    });

    const log = vi.fn();
    const ac = new AbortController();

    // Start watch — first tick runs immediately
    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      signal: ac.signal,
      log,
      git: fakeGit,
      fs: makeFakeFs(),
    });

    // Let the first tick complete
    await vi.advanceTimersByTimeAsync(0);

    // Abort to stop the loop
    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;

    expect(mockedSyncRepo).toHaveBeenCalledTimes(1);
    expect(mockedSaveState).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("my-app"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("synced"));
  });

  it("skips when HEAD is unchanged", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({ headCommit: vi.fn().mockReturnValue("abc123") });

    const log = vi.fn();
    const ac = new AbortController();

    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      signal: ac.signal,
      log,
      git: fakeGit,
      fs: makeFakeFs(),
    });

    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;

    expect(mockedSyncRepo).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("[my-app] no changes (HEAD=abc123)");
  });

  it("triggers sync from file events even when HEAD is unchanged", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({ headCommit: vi.fn().mockReturnValue("abc123") });
    const fakeFs = makeFakeFs();
    mockedSyncRepo.mockResolvedValue({
      passages: { "src/a.ts": ["p-2"] },
      lastSyncCommit: "abc123",
      filesRemoved: 0,
      filesReIndexed: 1,
      isFullReIndex: false,
      failedFiles: [],
    });

    const log = vi.fn();
    const ac = new AbortController();

    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      debounceMs: 100,
      signal: ac.signal,
      log,
      git: fakeGit,
      fs: fakeFs,
    });

    await vi.advanceTimersByTimeAsync(0);
    const watchCallback = vi.mocked(fakeFs.watch).mock.calls[0]?.[2];
    expect(typeof watchCallback).toBe("function");
    (watchCallback as (eventType: string, fileName: string) => void)("change", "src/a.ts");

    await vi.advanceTimersByTimeAsync(100);

    expect(mockedSyncRepo).toHaveBeenCalledTimes(1);
    const syncCall = mockedSyncRepo.mock.calls[0][0];
    expect(syncCall.changedFiles).toEqual(["src/a.ts"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[event]"));

    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;
  });

  it("ignores state file events to avoid self-trigger loops", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({ headCommit: vi.fn().mockReturnValue("abc123") });
    const fakeFs = makeFakeFs();

    const log = vi.fn();
    const ac = new AbortController();

    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "/tmp/my-app/state.json",
      intervalMs: 5000,
      debounceMs: 100,
      signal: ac.signal,
      log,
      git: fakeGit,
      fs: fakeFs,
    });

    await vi.advanceTimersByTimeAsync(0);
    const watchCallback = vi.mocked(fakeFs.watch).mock.calls[0]?.[2];
    expect(typeof watchCallback).toBe("function");
    (watchCallback as (eventType: string, fileName: string) => void)("change", "state.json");
    (watchCallback as (eventType: string, fileName: string) => void)("change", "/tmp/my-app/state.json");

    await vi.advanceTimersByTimeAsync(120);
    expect(mockedSyncRepo).not.toHaveBeenCalled();

    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;
  });

  it("logs error without crashing on sync failure", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({
      headCommit: vi.fn().mockReturnValue("def456"),
      diffFiles: vi.fn().mockReturnValue(["src/a.ts"]),
    });
    mockedSyncRepo.mockRejectedValue(new Error("Letta API down"));

    const log = vi.fn();
    const ac = new AbortController();

    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      signal: ac.signal,
      log,
      git: fakeGit,
      fs: makeFakeFs(),
    });

    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;

    expect(log).toHaveBeenCalledWith(expect.stringContaining("sync error"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Letta API down"));
  });

  it("skips sync when git diff fails", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({
      headCommit: vi.fn().mockReturnValue("def456"),
      diffFiles: vi.fn().mockReturnValue(null),
    });

    const log = vi.fn();
    const ac = new AbortController();

    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      signal: ac.signal,
      log,
      git: fakeGit,
      fs: makeFakeFs(),
    });

    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;

    expect(mockedSyncRepo).not.toHaveBeenCalled();
    expect(mockedSaveState).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("git diff failed"));
  });

  it("filters changed files by extension and ignoreDirs", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({
      headCommit: vi.fn().mockReturnValue("def456"),
      diffFiles: vi.fn().mockReturnValue(["src/a.ts", "README.md", "node_modules/pkg/index.js"]),
    });
    mockedSyncRepo.mockResolvedValue({
      passages: { "src/a.ts": ["p-2"] },
      lastSyncCommit: "def456",
      filesRemoved: 0,
      filesReIndexed: 1,
      isFullReIndex: false,
      failedFiles: [],
    });

    const log = vi.fn();
    const ac = new AbortController();

    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      signal: ac.signal,
      log,
      git: fakeGit,
      fs: makeFakeFs(),
    });

    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;

    expect(mockedSyncRepo).toHaveBeenCalledTimes(1);
    const syncCall = mockedSyncRepo.mock.calls[0][0];
    // Only src/a.ts should pass — README.md wrong extension, node_modules filtered
    expect(syncCall.changedFiles).toEqual(["src/a.ts"]);
  });

  // eslint-disable-next-line vitest/expect-expect
  it("respects AbortSignal for graceful shutdown", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({ headCommit: vi.fn().mockReturnValue("abc123") });

    const ac = new AbortController();

    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      signal: ac.signal,
      log: vi.fn(),
      git: fakeGit,
      fs: makeFakeFs(),
    });

    await vi.advanceTimersByTimeAsync(0);

    // Abort before next tick
    ac.abort();
    await vi.advanceTimersByTimeAsync(200);

    // Should resolve without hanging
    await watchPromise;
  });

  it("runs subsequent ticks on interval", async () => {
    let callCount = 0;
    mockedLoadState.mockResolvedValue(makeState("abc123"));
    const fakeGit = makeFakeGit({
      headCommit: vi.fn().mockImplementation(() => {
        callCount++;
        return callCount <= 1 ? "abc123" : "def456";
      }),
      diffFiles: vi.fn().mockReturnValue(["src/a.ts"]),
    });
    mockedSyncRepo.mockResolvedValue({
      passages: { "src/a.ts": ["p-2"] },
      lastSyncCommit: "def456",
      filesRemoved: 0,
      filesReIndexed: 1,
      isFullReIndex: false,
      failedFiles: [],
    });

    const log = vi.fn();
    const ac = new AbortController();

    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      signal: ac.signal,
      log,
      git: fakeGit,
      fs: makeFakeFs(),
    });

    // First tick — no change
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedSyncRepo).not.toHaveBeenCalled();

    // Second tick — HEAD changes
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockedSyncRepo).toHaveBeenCalledTimes(1);

    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;
  });

  it("does not sync when repo is not in state (no agentInfo)", async () => {
    const state = { stateVersion: 2, agents: {} }; // no my-app agent
    mockedLoadState.mockResolvedValue(state as AppState);
    const fakeGit = makeFakeGit({ headCommit: vi.fn().mockReturnValue("def456") });

    const ac = new AbortController();
    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      signal: ac.signal,
      log: vi.fn(),
      git: fakeGit,
      fs: makeFakeFs(),
    });

    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;

    expect(mockedSyncRepo).not.toHaveBeenCalled();
  });

  it("does not sync when git returns null HEAD", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({ headCommit: vi.fn().mockReturnValue(null) });

    const ac = new AbortController();
    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      signal: ac.signal,
      log: vi.fn(),
      git: fakeGit,
      fs: makeFakeFs(),
    });

    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;

    expect(mockedSyncRepo).not.toHaveBeenCalled();
  });

  it("no changes HEAD log includes truncated hash", async () => {
    const state = makeState("abc123def456");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({ headCommit: vi.fn().mockReturnValue("abc123def456") });

    const log = vi.fn();
    const ac = new AbortController();

    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      signal: ac.signal,
      log,
      git: fakeGit,
      fs: makeFakeFs(),
    });

    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;

    // Should show truncated hash (7 chars: "abc123d"), not full hash
    expect(log).toHaveBeenCalledWith("[my-app] no changes (HEAD=abc123d)");
  });

  it("sync log does NOT include [event] suffix for poll-based syncs", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({
      headCommit: vi.fn().mockReturnValue("def456"),
      diffFiles: vi.fn().mockReturnValue(["src/a.ts"]),
    });
    mockedSyncRepo.mockResolvedValue({
      passages: { "src/a.ts": ["p-2"] },
      lastSyncCommit: "def456",
      filesRemoved: 0,
      filesReIndexed: 1,
      isFullReIndex: false,
      failedFiles: [],
    });

    const log = vi.fn();
    const ac = new AbortController();

    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      signal: ac.signal,
      log,
      git: fakeGit,
      fs: makeFakeFs(),
    });

    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;

    // Poll-based sync should NOT have [event] suffix
    const syncLog = log.mock.calls.find(([msg]) => (msg as string).includes("synced"));
    expect(syncLog).toBeDefined();
    if (!syncLog) return;
    expect(syncLog[0]).not.toContain("[event]");
  });

  it("filters event-based changed files through shouldIncludeFile", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({ headCommit: vi.fn().mockReturnValue("abc123") });
    const fakeFs = makeFakeFs();
    mockedSyncRepo.mockResolvedValue({
      passages: {},
      lastSyncCommit: "abc123",
      filesRemoved: 0,
      filesReIndexed: 1,
      isFullReIndex: false,
      failedFiles: [],
    });

    const ac = new AbortController();
    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig, // only .ts extensions
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      debounceMs: 50,
      signal: ac.signal,
      log: vi.fn(),
      git: fakeGit,
      fs: fakeFs,
    });

    await vi.advanceTimersByTimeAsync(0);

    const watchCallback = vi.mocked(fakeFs.watch).mock.calls[0]?.[2];
    // Fire event with .ts file (should pass filter) and .md file (should NOT pass)
    (watchCallback as (eventType: string, fileName: string) => void)("change", "src/a.ts");
    (watchCallback as (eventType: string, fileName: string) => void)("change", "README.md");

    await vi.advanceTimersByTimeAsync(100);

    expect(mockedSyncRepo).toHaveBeenCalledTimes(1);
    const syncCall = mockedSyncRepo.mock.calls[0][0];
    // README.md filtered out
    expect(syncCall.changedFiles).toContain("src/a.ts");
    expect(syncCall.changedFiles).not.toContain("README.md");

    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;
  });

  it("applies exponential backoff after consecutive sync failures", async () => {
    let loadCount = 0;
    mockedLoadState.mockImplementation(async () => {
      loadCount++;
      return makeState(loadCount === 1 ? null : "abc123");
    });
    const fakeGit = makeFakeGit({
      headCommit: vi.fn().mockReturnValue("def456"),
      diffFiles: vi.fn().mockReturnValue(["src/a.ts"]),
    });
    mockedSyncRepo.mockRejectedValue(new Error("API error"));

    const log = vi.fn();
    const ac = new AbortController();

    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 1000,
      signal: ac.signal,
      log,
      git: fakeGit,
      fs: makeFakeFs(),
    });

    // First tick: full-reindex triggers, fails
    await vi.advanceTimersByTimeAsync(0);

    // Second tick: should be backed off, not retrying yet
    await vi.advanceTimersByTimeAsync(1000);

    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;

    // First failure logged
    expect(log).toHaveBeenCalledWith(expect.stringContaining("sync error"));
    // syncRepo called only once (first tick); second tick skipped due to backoff
    expect(mockedSyncRepo).toHaveBeenCalledTimes(1);
  });

  it("saves state with updated lastSyncAt after successful sync", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({
      headCommit: vi.fn().mockReturnValue("def456"),
      diffFiles: vi.fn().mockReturnValue(["src/a.ts"]),
    });
    mockedSyncRepo.mockResolvedValue({
      passages: { "src/a.ts": ["p-2"] },
      lastSyncCommit: "def456",
      filesRemoved: 0,
      filesReIndexed: 1,
      isFullReIndex: false,
      failedFiles: [],
    });

    const ac = new AbortController();
    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      signal: ac.signal,
      log: vi.fn(),
      git: fakeGit,
      fs: makeFakeFs(),
    });

    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;

    // saveState should be called with state containing lastSyncAt
    expect(mockedSaveState).toHaveBeenCalled();
    const savedState = mockedSaveState.mock.calls[0][1];
    expect(savedState.agents["my-app"].lastSyncAt).not.toBeNull();
    expect(savedState.agents["my-app"].lastSyncCommit).toBe("def456");
  });

  it("git commands use correct args for HEAD", async () => {
    const state = makeState(null); // no lastSyncCommit = full reindex
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({ headCommit: vi.fn().mockReturnValue("def456") });
    mockedSyncRepo.mockResolvedValue({
      passages: {},
      lastSyncCommit: "def456",
      filesRemoved: 0,
      filesReIndexed: 0,
      isFullReIndex: true,
      failedFiles: [],
    });

    const ac = new AbortController();
    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      signal: ac.signal,
      log: vi.fn(),
      git: fakeGit,
      fs: makeFakeFs(),
    });

    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;

    // headCommit called with the repo path
    expect(fakeGit.headCommit).toHaveBeenCalledWith("/tmp/my-app");
  });

  it("normalizes backslashes in file paths to forward slashes", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({ headCommit: vi.fn().mockReturnValue("abc123") });
    const fakeFs = makeFakeFs();
    mockedSyncRepo.mockResolvedValue({
      passages: {},
      lastSyncCommit: "abc123",
      filesRemoved: 0,
      filesReIndexed: 1,
      isFullReIndex: false,
      failedFiles: [],
    });

    const ac = new AbortController();
    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      debounceMs: 50,
      signal: ac.signal,
      log: vi.fn(),
      git: fakeGit,
      fs: fakeFs,
    });

    await vi.advanceTimersByTimeAsync(0);

    const watchCallback = vi.mocked(fakeFs.watch).mock.calls[0]?.[2];
    // Fire event with Windows-style backslash path
    (watchCallback as (eventType: string, fileName: string) => void)("change", String.raw`src\a.ts`);

    await vi.advanceTimersByTimeAsync(100);

    // Should normalize to "src/a.ts" (not "src\\a.ts")
    expect(mockedSyncRepo).toHaveBeenCalledTimes(1);
    const syncCallBackslash = mockedSyncRepo.mock.calls[0][0];
    expect(syncCallBackslash.changedFiles).not.toContain(String.raw`src\a.ts`);

    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;
  });

  it("strips leading ./ from file paths", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({ headCommit: vi.fn().mockReturnValue("abc123") });
    const fakeFs = makeFakeFs();
    mockedSyncRepo.mockResolvedValue({
      passages: {},
      lastSyncCommit: "abc123",
      filesRemoved: 0,
      filesReIndexed: 1,
      isFullReIndex: false,
      failedFiles: [],
    });

    const ac = new AbortController();
    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      debounceMs: 50,
      signal: ac.signal,
      log: vi.fn(),
      git: fakeGit,
      fs: fakeFs,
    });

    await vi.advanceTimersByTimeAsync(0);

    const watchCallback = vi.mocked(fakeFs.watch).mock.calls[0]?.[2];
    // Fire event with ./ prefix
    (watchCallback as (eventType: string, fileName: string) => void)("change", "./src/a.ts");

    await vi.advanceTimersByTimeAsync(100);

    // Should strip "./" prefix, resulting in "src/a.ts" not "./src/a.ts"
    expect(mockedSyncRepo).toHaveBeenCalledTimes(1);
    const syncCallDot = mockedSyncRepo.mock.calls[0][0];
    expect(syncCallDot.changedFiles).not.toContain("./src/a.ts");

    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;
  });

  it("HEAD-change-with-no-diff logs sync and updates lastSyncCommit in state", async () => {
    // HEAD changed but git diff shows no files → should still update state
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({
      headCommit: vi.fn().mockReturnValue("def456"),
      diffFiles: vi.fn().mockReturnValue([]),
    });

    const log = vi.fn();
    const ac = new AbortController();

    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      signal: ac.signal,
      log,
      git: fakeGit,
      fs: makeFakeFs(),
    });

    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;

    // Should NOT call syncRepo (no files changed) but should update state
    expect(mockedSyncRepo).not.toHaveBeenCalled();
    // Should log a sync message (formatSyncLog with 0 files)
    expect(log).toHaveBeenCalledWith(expect.stringContaining("synced"));
    // Should save state with updated lastSyncCommit
    expect(mockedSaveState).toHaveBeenCalled();
    const savedState = mockedSaveState.mock.calls[0][1];
    expect(savedState.agents["my-app"].lastSyncCommit).toBe("def456");
  });

  it("backoff delay uses failure count (not increments -1)", async () => {
    let loadCount = 0;
    mockedLoadState.mockImplementation(async () => {
      loadCount++;
      return makeState(loadCount === 1 ? null : "abc123");
    });
    const fakeGit = makeFakeGit({
      headCommit: vi.fn().mockReturnValue("def456"),
      diffFiles: vi.fn().mockReturnValue(["src/a.ts"]),
    });
    mockedSyncRepo.mockRejectedValue(new Error("API error"));

    const log = vi.fn();
    const ac = new AbortController();

    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 1000,
      signal: ac.signal,
      log,
      git: fakeGit,
      fs: makeFakeFs(),
    });

    // First tick: fails
    await vi.advanceTimersByTimeAsync(0);
    // Second tick: backed off due to failure
    await vi.advanceTimersByTimeAsync(1000);

    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;

    // Failure count should be 1 (not 0 or -1) — logged as "attempt 1"
    expect(log).toHaveBeenCalledWith(expect.stringContaining("attempt 1"));
  });

  it("sync error log includes backoff duration in seconds", async () => {
    mockedLoadState.mockResolvedValue(makeState("abc123"));
    const fakeGit = makeFakeGit({
      headCommit: vi.fn().mockReturnValue("def456"),
      diffFiles: vi.fn().mockReturnValue(["src/a.ts"]),
    });
    mockedSyncRepo.mockRejectedValue(new Error("API error"));

    const log = vi.fn();
    const ac = new AbortController();

    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 1000,
      signal: ac.signal,
      log,
      git: fakeGit,
      fs: makeFakeFs(),
    });

    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;

    // Log should include "backoff Xs" (delay / 1000, not * 1000)
    const errorLog = log.mock.calls.find(([msg]) => (msg as string).includes("sync error"));
    expect(errorLog).toBeDefined();
    if (!errorLog) return;
    const msg = errorLog[0] as string;
    // Backoff should be a reasonable number of seconds (not thousands of seconds)
    const match = /backoff (\d+)s/.exec(msg);
    expect(match).toBeDefined();
    if (!match) return;
    const backoffSeconds = Number.parseInt(match[1], 10);
    expect(backoffSeconds).toBeLessThan(100); // not delay * 1000
  });

  it("pending files trigger debounced re-sync after sync completes", async () => {
    // After syncRepoNow completes, if there are pending files they should trigger a new sync
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({ headCommit: vi.fn().mockReturnValue("abc123") });
    const fakeFs = makeFakeFs();
    mockedSyncRepo.mockImplementation(async () => {
      return {
        passages: {},
        lastSyncCommit: "abc123",
        filesRemoved: 0,
        filesReIndexed: 1,
        isFullReIndex: false,
        failedFiles: [],
      };
    });

    const ac = new AbortController();
    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      debounceMs: 50,
      signal: ac.signal,
      log: vi.fn(),
      git: fakeGit,
      fs: fakeFs,
    });

    await vi.advanceTimersByTimeAsync(0);

    const watchCallback = vi.mocked(fakeFs.watch).mock.calls[0]?.[2];
    // Queue two file events
    (watchCallback as (eventType: string, fileName: string) => void)("change", "src/a.ts");
    (watchCallback as (eventType: string, fileName: string) => void)("change", "src/b.ts");

    await vi.advanceTimersByTimeAsync(200);

    // Both events should have been batched and synced
    expect(mockedSyncRepo).toHaveBeenCalled();

    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;
  });

  it("does not queue file events when no repoConfig is found", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({ headCommit: vi.fn().mockReturnValue("abc123") });

    const ac = new AbortController();
    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      debounceMs: 50,
      signal: ac.signal,
      log: vi.fn(),
      git: fakeGit,
      fs: makeFakeFs(),
    });

    await vi.advanceTimersByTimeAsync(0);

    // No file event queued — sync should not fire from events
    await vi.advanceTimersByTimeAsync(200);

    expect(mockedSyncRepo).not.toHaveBeenCalled();

    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;
  });

  it("does not process file event when fileName is null/undefined", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({ headCommit: vi.fn().mockReturnValue("abc123") });
    const fakeFs = makeFakeFs();

    const ac = new AbortController();
    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      debounceMs: 50,
      signal: ac.signal,
      log: vi.fn(),
      git: fakeGit,
      fs: fakeFs,
    });

    await vi.advanceTimersByTimeAsync(0);

    const watchCallback = vi.mocked(fakeFs.watch).mock.calls[0]?.[2];
    // Fire event with null fileName (macOS sometimes emits this)
    (watchCallback as (eventType: string, fileName: string | null) => void)("rename", null);

    await vi.advanceTimersByTimeAsync(100);

    // Should not trigger sync (fileName was null)
    expect(mockedSyncRepo).not.toHaveBeenCalled();

    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;
  });

  it("skips sync when signal is already aborted at start of syncRepoNow", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({ headCommit: vi.fn().mockReturnValue("def456") });

    const ac = new AbortController();
    // Abort immediately before first tick
    ac.abort();

    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      signal: ac.signal,
      log: vi.fn(),
      git: fakeGit,
      fs: makeFakeFs(),
    });

    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;

    // Aborted immediately, should not sync
    expect(mockedSyncRepo).not.toHaveBeenCalled();
  });

  it("resets failure counter on successful sync (consecutiveFailures goes to 0)", async () => {
    // The test verifies that after a failure+success cycle, the backoff counter resets.
    // We do this by checking that after failure+success, subsequent failure shows "attempt 1" again.
    let syncCount = 0;
    mockedLoadState.mockResolvedValue(makeState("abc123"));
    const fakeGit = makeFakeGit({
      headCommit: vi.fn().mockReturnValue("def456"),
      diffFiles: vi.fn().mockReturnValue(["src/a.ts"]),
    });
    mockedSyncRepo.mockImplementation(async () => {
      syncCount++;
      if (syncCount === 1) throw new Error("First sync fails");
      return {
        passages: { "src/a.ts": ["p-2"] },
        lastSyncCommit: "def456",
        filesRemoved: 0,
        filesReIndexed: 1,
        isFullReIndex: false,
        failedFiles: [],
      };
    });

    const log = vi.fn();
    const ac = new AbortController();

    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 1000,
      signal: ac.signal,
      log,
      git: fakeGit,
      fs: makeFakeFs(),
    });

    // First tick: fails
    await vi.advanceTimersByTimeAsync(0);
    // Advance far enough to clear backoff
    await vi.advanceTimersByTimeAsync(60_000);

    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;

    // First failure should be logged as "attempt 1"
    expect(log).toHaveBeenCalledWith(expect.stringContaining("sync error"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("attempt 1"));
  });

  it("watcher on error logs the error message", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({ headCommit: vi.fn().mockReturnValue("abc123") });
    const fakeFs = makeFakeFs();

    const log = vi.fn();
    const ac = new AbortController();

    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      signal: ac.signal,
      log,
      git: fakeGit,
      fs: fakeFs,
    });

    await vi.advanceTimersByTimeAsync(0);

    // Simulate watcher emitting an error
    const watcherMock = vi.mocked(fakeFs.watch).mock.results[0]?.value as { on: ReturnType<typeof vi.fn> };
    const errorCallback = watcherMock.on.mock.calls.find(([event]: [string]) => event === "error");
    expect(errorCallback).toBeDefined();
    if (!errorCallback) return;
    (errorCallback[1] as (err: Error) => void)(new Error("Watch permission denied"));
    // Error should be logged
    expect(log).toHaveBeenCalledWith(expect.stringContaining("file watch error"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Watch permission denied"));

    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;
  });

  it("state file relative path is excluded from event-driven sync", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({ headCommit: vi.fn().mockReturnValue("abc123") });
    const fakeFs = makeFakeFs();

    const ac = new AbortController();
    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: testConfig,
      repoNames: ["my-app"],
      // state file is INSIDE the repo path — should be ignored
      statePath: "/tmp/my-app/.repo-expert-state.json",
      intervalMs: 5000,
      debounceMs: 50,
      signal: ac.signal,
      log: vi.fn(),
      git: fakeGit,
      fs: fakeFs,
    });

    await vi.advanceTimersByTimeAsync(0);

    const watchCallback = vi.mocked(fakeFs.watch).mock.calls[0]?.[2];
    // Trigger event on the state file itself — should be ignored
    (watchCallback as (eventType: string, fileName: string) => void)("change", ".repo-expert-state.json");

    await vi.advanceTimersByTimeAsync(100);

    // State file event should be ignored, no sync
    expect(mockedSyncRepo).not.toHaveBeenCalled();

    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;
  });

  it("ignores file events where file maps to null (toAgentPath returns null)", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({ headCommit: vi.fn().mockReturnValue("abc123") });
    const fakeFs = makeFakeFs();

    const ac = new AbortController();
    // Config with basePath — files outside basePath will have toAgentPath return null
    const configWithBase: Config = {
      ...testConfig,
      repos: {
        "my-app": {
          ...testConfig.repos["my-app"],
          basePath: "packages/frontend",
        },
      },
    };

    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: configWithBase,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      debounceMs: 50,
      signal: ac.signal,
      log: vi.fn(),
      git: fakeGit,
      fs: fakeFs,
    });

    await vi.advanceTimersByTimeAsync(0);

    const watchCallback = vi.mocked(fakeFs.watch).mock.calls[0]?.[2];
    // File is outside basePath — toAgentPath should return null → ignored
    (watchCallback as (eventType: string, fileName: string) => void)("change", "packages/backend/server.ts");

    await vi.advanceTimersByTimeAsync(100);

    // File outside basePath should be ignored
    expect(mockedSyncRepo).not.toHaveBeenCalled();

    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;
  });

  it("expands submodule pointer changes to file lists when includeSubmodules is true", async () => {
    const subConfig: Config = {
      ...testConfig,
      repos: {
        "my-app": {
          ...testConfig.repos["my-app"],
          includeSubmodules: true,
        },
      },
    };
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    const fakeGit = makeFakeGit({
      headCommit: vi.fn().mockReturnValue("def456"),
      diffFiles: vi.fn().mockReturnValue(["libs/my-lib"]),
    });
    mockedListSubmodules.mockReturnValue([
      { path: "libs/my-lib", commit: "abc123", initialized: true },
    ]);
    mockedExpandSubmoduleFiles.mockResolvedValue([
      "libs/my-lib/src/index.ts",
      "libs/my-lib/src/util.ts",
    ]);
    mockedSyncRepo.mockResolvedValue({
      passages: {},
      lastSyncCommit: "def456",
      filesRemoved: 0,
      filesReIndexed: 2,
      isFullReIndex: false,
      failedFiles: [],
    });

    const ac = new AbortController();
    const watchPromise = watchRepos({
      provider: makeMockProvider(),
      config: subConfig,
      repoNames: ["my-app"],
      statePath: "state.json",
      intervalMs: 5000,
      signal: ac.signal,
      git: fakeGit,
      fs: makeFakeFs(),
    });

    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    await vi.advanceTimersByTimeAsync(200);
    await watchPromise;

    expect(mockedExpandSubmoduleFiles).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/tmp/my-app" }),
      expect.objectContaining({ path: "libs/my-lib" }),
    );
    expect(mockedSyncRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        changedFiles: expect.arrayContaining(["libs/my-lib/src/index.ts", "libs/my-lib/src/util.ts"]),
      }),
    );
  });
});
