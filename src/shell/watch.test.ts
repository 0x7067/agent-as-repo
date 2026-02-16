import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Config, AppState } from "../core/types.js";

// Mock child_process and fs before importing watch module
vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
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
import { loadState, saveState } from "./state-store.js";
import { syncRepo } from "./sync.js";
import { watchRepos } from "./watch.js";

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedLoadState = vi.mocked(loadState);
const mockedSaveState = vi.mocked(saveState);
const mockedSyncRepo = vi.mocked(syncRepo);

// Import shared mock after vi.mock calls
import { makeMockProvider } from "./__test__/mock-provider.js";

const testConfig: Config = {
  letta: { model: "letta-free", embedding: "letta-free" },
  defaults: { maxFileSizeKb: 50, memoryBlockLimit: 5000, bootstrapOnCreate: false },
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
    expect(log).not.toHaveBeenCalled();
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
