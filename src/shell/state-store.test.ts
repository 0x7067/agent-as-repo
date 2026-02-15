import { describe, it, expect } from "vitest";
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
      state = addAgentToState(state, "my-app", "agent-123");
      await saveState(filePath, state);
      const loaded = await loadState(filePath);
      expect(loaded.agents["my-app"].agentId).toBe("agent-123");
      expect(loaded.agents["my-app"].repoName).toBe("my-app");
    });
  });

  it("overwrites existing state file", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      let state = addAgentToState(createEmptyState(), "app1", "a1");
      await saveState(filePath, state);
      state = addAgentToState(createEmptyState(), "app2", "a2");
      await saveState(filePath, state);
      const loaded = await loadState(filePath);
      expect(loaded.agents["app1"]).toBeUndefined();
      expect(loaded.agents["app2"].agentId).toBe("a2");
    });
  });
});
