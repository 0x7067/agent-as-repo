import { describe, it, expect, vi } from "vitest";
import { loadState, saveState } from "./state-store.js";
import { createEmptyState, addAgentToState } from "../core/state.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "state-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
}

describe("state store", () => {
  it("returns empty state when file does not exist", async () => {
    await withTempDir(async (dir) => {
      const state = await loadState(path.join(dir, "state.json"));
      expect(state.agents).toEqual({});
    });
  });

  it("round-trips state through save and load", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      let state = createEmptyState();
      state = addAgentToState(state, "my-app", "agent-123", "2026-01-01T00:00:00.000Z");
      await saveState(filePath, state);
      const loaded = await loadState(filePath);
      expect(loaded.agents["my-app"].agentId).toBe("agent-123");
      expect(loaded.agents["my-app"].repoName).toBe("my-app");
    });
  });

  it("overwrites existing state file", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      let state = addAgentToState(createEmptyState(), "app1", "a1", "2026-01-01T00:00:00.000Z");
      await saveState(filePath, state);
      state = addAgentToState(createEmptyState(), "app2", "a2", "2026-01-01T00:00:00.000Z");
      await saveState(filePath, state);
      const loaded = await loadState(filePath);
      expect(loaded.agents["app1"]).toBeUndefined();
      expect(loaded.agents["app2"].agentId).toBe("a2");
    });
  });

  it("returns empty state for corrupted JSON", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      await fs.writeFile(filePath, "not valid json {{{{", "utf-8");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const state = await loadState(filePath);
      expect(state.agents).toEqual({});
      expect(warnSpy).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
    });
  });

  it("returns empty state for invalid schema", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      await fs.writeFile(
        filePath,
        JSON.stringify({ agents: { repo: { agentId: 123 } } }),
        "utf-8",
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const state = await loadState(filePath);
      expect(state.agents).toEqual({});
      expect(warnSpy).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
    });
  });

  it("loads valid state with missing optional fields", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      const minimal = {
        agents: {
          "my-app": {
            agentId: "agent-1",
            repoName: "my-app",
          },
        },
      };
      await fs.writeFile(filePath, JSON.stringify(minimal), "utf-8");
      const loaded = await loadState(filePath);
      expect(loaded.agents["my-app"].agentId).toBe("agent-1");
      expect(loaded.agents["my-app"].passages).toEqual({});
      expect(loaded.agents["my-app"].lastBootstrap).toBeNull();
      expect(loaded.agents["my-app"].lastSyncCommit).toBeNull();
      expect(loaded.agents["my-app"].lastSyncAt).toBeNull();
    });
  });
});
