import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Config, AppState } from "../core/types.js";
import type { FSWatcher } from "fs";

// Mock child_process and fs before importing watch module
vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("fs", () => ({
  watch: vi.fn(),
}));

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

import { execFileSync } from "child_process";
import { watch as fsWatch } from "fs";
import { loadState, saveState } from "./state-store.js";
import { syncRepo } from "./sync.js";
import { watchRepos } from "./watch.js";

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedFsWatch = vi.mocked(fsWatch);
const mockedLoadState = vi.mocked(loadState);
const mockedSaveState = vi.mocked(saveState);
const mockedSyncRepo = vi.mocked(syncRepo);

// Import shared mock after vi.mock calls
import { makeMockProvider } from "./__test__/mock-provider.js";

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
  mockedFsWatch.mockImplementation(
    () =>
      ({
        close: vi.fn(),
        on: vi.fn().mockReturnThis(),
      }) as unknown as FSWatcher,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("watchRepos", () => {
  it("triggers sync when HEAD changes", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    mockedExecFileSync.mockImplementation((_cmd: string, args?: readonly string[]) => {
      if (args?.includes("rev-parse")) return "def456\n";
      if (args?.includes("--name-only")) return "src/a.ts\n";
      return "";
    });
    mockedSyncRepo.mockResolvedValue({
      passages: { "src/a.ts": ["p-2"] },
      lastSyncCommit: "def456",
      filesDeleted: 0,
      filesReIndexed: 1,
      isFullReIndex: false,
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
    mockedExecFileSync.mockImplementation((_cmd: string, args?: readonly string[]) => {
      if (args?.includes("rev-parse")) return "abc123\n";
      return "";
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
    mockedExecFileSync.mockImplementation((_cmd: string, args?: readonly string[]) => {
      if (args?.includes("rev-parse")) return "abc123\n";
      return "";
    });
    mockedSyncRepo.mockResolvedValue({
      passages: { "src/a.ts": ["p-2"] },
      lastSyncCommit: "abc123",
      filesDeleted: 0,
      filesReIndexed: 1,
      isFullReIndex: false,
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
    });

    await vi.advanceTimersByTimeAsync(0);
    const watchCallback = mockedFsWatch.mock.calls[0]?.[2];
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
    mockedExecFileSync.mockImplementation((_cmd: string, args?: readonly string[]) => {
      if (args?.includes("rev-parse")) return "abc123\n";
      return "";
    });

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
    });

    await vi.advanceTimersByTimeAsync(0);
    const watchCallback = mockedFsWatch.mock.calls[0]?.[2];
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
    mockedExecFileSync.mockImplementation((_cmd: string, args?: readonly string[]) => {
      if (args?.includes("rev-parse")) return "def456\n";
      if (args?.includes("--name-only")) return "src/a.ts\n";
      return "";
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
    mockedExecFileSync.mockImplementation((_cmd: string, args?: readonly string[]) => {
      if (args?.includes("rev-parse")) return "def456\n";
      if (args?.includes("--name-only")) throw new Error("git diff failed");
      return "";
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
    mockedExecFileSync.mockImplementation((_cmd: string, args?: readonly string[]) => {
      if (args?.includes("rev-parse")) return "def456\n";
      if (args?.includes("--name-only")) return "src/a.ts\nREADME.md\nnode_modules/pkg/index.js\n";
      return "";
    });
    mockedSyncRepo.mockResolvedValue({
      passages: { "src/a.ts": ["p-2"] },
      lastSyncCommit: "def456",
      filesDeleted: 0,
      filesReIndexed: 1,
      isFullReIndex: false,
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

  it("respects AbortSignal for graceful shutdown", async () => {
    const state = makeState("abc123");
    mockedLoadState.mockResolvedValue(state);
    mockedExecFileSync.mockImplementation((_cmd: string, args?: readonly string[]) => {
      if (args?.includes("rev-parse")) return "abc123\n";
      return "";
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
    mockedExecFileSync.mockImplementation((_cmd: string, args?: readonly string[]) => {
      if (args?.includes("rev-parse")) {
        callCount++;
        // HEAD changes on second tick
        return callCount <= 1 ? "abc123\n" : "def456\n";
      }
      if (args?.includes("--name-only")) return "src/a.ts\n";
      return "";
    });
    mockedSyncRepo.mockResolvedValue({
      passages: { "src/a.ts": ["p-2"] },
      lastSyncCommit: "def456",
      filesDeleted: 0,
      filesReIndexed: 1,
      isFullReIndex: false,
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
});
