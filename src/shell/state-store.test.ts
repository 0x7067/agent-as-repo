import { afterEach, describe, expect, it, vi } from "vitest";
import { loadState, saveState, setRenameFnForTests } from "./state-store.js";
import { STATE_SCHEMA_VERSION, addAgentToState, createEmptyState } from "../core/state.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

afterEach(() => {
  vi.restoreAllMocks();
  setRenameFnForTests(null);
});

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
      expect(state.stateVersion).toBe(STATE_SCHEMA_VERSION);
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
      expect(loaded.stateVersion).toBe(STATE_SCHEMA_VERSION);
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
      expect(loaded.stateVersion).toBe(STATE_SCHEMA_VERSION);
      expect(loaded.agents["app1"]).toBeUndefined();
      expect(loaded.agents["app2"].agentId).toBe("a2");
    });
  });

  it("throws actionable error for corrupted JSON", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      await fs.writeFile(filePath, "not valid json {{{{", "utf-8");
      let message = "";
      try {
        await loadState(filePath);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message).toContain("Invalid state file");
      expect(message).toContain(filePath);
      const files = await fs.readdir(dir);
      const backups = files.filter((name) => name.startsWith("state.json.bak."));
      expect(backups.length).toBe(1);
    });
  });

  it("throws actionable error for invalid schema", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      await fs.writeFile(
        filePath,
        JSON.stringify({ agents: { repo: { agentId: 123 } } }),
        "utf-8",
      );
      await expect(loadState(filePath)).rejects.toThrow("Invalid state file");
      await expect(loadState(filePath)).rejects.toThrow("remove or fix it");
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
      expect(loaded.stateVersion).toBe(STATE_SCHEMA_VERSION);
      expect(loaded.agents["my-app"].agentId).toBe("agent-1");
      expect(loaded.agents["my-app"].passages).toEqual({});
      expect(loaded.agents["my-app"].lastBootstrap).toBeNull();
      expect(loaded.agents["my-app"].lastSyncCommit).toBeNull();
      expect(loaded.agents["my-app"].lastSyncAt).toBeNull();
    });
  });

  it("saves state atomically without temp-file residue", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      let state = createEmptyState();
      state = addAgentToState(state, "my-app", "agent-123", "2026-01-01T00:00:00.000Z");

      await saveState(filePath, state);
      const content = await fs.readFile(filePath, "utf-8");
      expect(JSON.parse(content)).toMatchObject({
        stateVersion: STATE_SCHEMA_VERSION,
        agents: {
          "my-app": { agentId: "agent-123" },
        },
      });

      const files = await fs.readdir(dir);
      const tempFiles = files.filter((name) => name.startsWith(".state.json.tmp."));
      expect(tempFiles).toEqual([]);
    });
  });

  it("migrates legacy state without stateVersion", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      const legacy = {
        agents: {
          "my-app": {
            agentId: "agent-1",
            repoName: "my-app",
            passages: {},
            lastBootstrap: null,
            lastSyncCommit: null,
            lastSyncAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        },
      };
      await fs.writeFile(filePath, JSON.stringify(legacy), "utf-8");

      const loaded = await loadState(filePath);
      expect(loaded.stateVersion).toBe(STATE_SCHEMA_VERSION);
      expect(loaded.agents["my-app"].agentId).toBe("agent-1");
    });
  });

  it("backs up and fails on unsupported state version", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      const unsupported = {
        stateVersion: 999,
        agents: {},
      };
      await fs.writeFile(filePath, JSON.stringify(unsupported), "utf-8");

      await expect(loadState(filePath)).rejects.toThrow("unsupported state version");
      const files = await fs.readdir(dir);
      const backups = files.filter((name) => name.startsWith("state.json.bak."));
      expect(backups.length).toBe(1);
    });
  });

  it("retries rename when state save hits transient lock contention", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      const state = addAgentToState(createEmptyState(), "my-app", "agent-1", "2026-01-01T00:00:00.000Z");
      const busyErr = Object.assign(new Error("busy"), { code: "EBUSY" });
      let calls = 0;
      setRenameFnForTests(async (fromPath, toPath) => {
        calls++;
        if (calls === 1) throw busyErr;
        await fs.rename(fromPath, toPath);
      });

      await saveState(filePath, state);
      const loaded = await loadState(filePath);
      expect(loaded.agents["my-app"].agentId).toBe("agent-1");
      expect(calls).toBe(2);
    });
  });

  it("keeps state JSON valid under concurrent saves", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      const saves = Array.from({ length: 20 }).map((_, i) => {
        const repoName = `repo-${i}`;
        const state = addAgentToState(createEmptyState(), repoName, `agent-${i}`, "2026-01-01T00:00:00.000Z");
        return saveState(filePath, state);
      });

      await Promise.all(saves);
      const raw = await fs.readFile(filePath, "utf-8");
      expect(() => JSON.parse(raw)).not.toThrow();
      const loaded = await loadState(filePath);
      expect(Object.keys(loaded.agents).length).toBe(1);
    });
  });
});
