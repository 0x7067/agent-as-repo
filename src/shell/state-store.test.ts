import { describe, expect, it } from "vitest";
import { loadState, saveState } from "./state-store.js";
import { STATE_SCHEMA_VERSION, addAgentToState, createEmptyState } from "../core/state.js";
import { nodeFileSystem } from "./adapters/node-filesystem.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { FileSystemPort } from "../ports/filesystem.js";

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
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
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
      const content = await fs.readFile(filePath, "utf8");
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
      let renameCalls = 0;

      const mockFs: FileSystemPort = {
        ...nodeFileSystem,
        rename: async (from, to) => {
          renameCalls++;
          if (renameCalls === 1) throw busyErr;
          await nodeFileSystem.rename(from, to);
        },
      };

      await saveState(filePath, state, mockFs);
      const loaded = await loadState(filePath);
      expect(loaded.agents["my-app"].agentId).toBe("agent-1");
      expect(renameCalls).toBe(2);
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
      const raw = await fs.readFile(filePath, "utf8");
      expect(() => JSON.parse(raw)).not.toThrow();
      const loaded = await loadState(filePath);
      expect(Object.keys(loaded.agents).length).toBe(1);
    });
  });

  it("migrates state with stateVersion=1 to current version", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      const v1State = {
        stateVersion: 1,
        agents: {
          "my-app": {
            agentId: "agent-v1",
            repoName: "my-app",
            passages: {},
            lastBootstrap: null,
            lastSyncCommit: null,
            lastSyncAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        },
      };
      await fs.writeFile(filePath, JSON.stringify(v1State), "utf-8");

      const loaded = await loadState(filePath);
      expect(loaded.stateVersion).toBe(STATE_SCHEMA_VERSION);
      expect(loaded.agents["my-app"].agentId).toBe("agent-v1");
    });
  });

  it("passes null through migrateLegacyState without error", async () => {
    // Test that non-object raw values (null) are handled - they will fail schema parse
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      await fs.writeFile(filePath, "null", "utf-8");
      // null is not an object, so schema parse will fail -> StateFileError
      await expect(loadState(filePath)).rejects.toThrow("Invalid state file");
    });
  });

  it("StateFileError has name 'StateFileError'", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      await fs.writeFile(filePath, "bad json {{", "utf-8");
      try {
        await loadState(filePath);
        expect.fail("Should have thrown");
      } catch (error) {
        expect((error as Error).name).toBe("StateFileError");
      }
    });
  });

  it("StateFileError message includes backup path hint when backup was created", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      await fs.writeFile(filePath, "bad json {{", "utf-8");
      try {
        await loadState(filePath);
        expect.fail("Should have thrown");
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain("A backup was created at");
      }
    });
  });

  it("retries rename on EPERM error", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      const state = addAgentToState(createEmptyState(), "my-app", "agent-1", "2026-01-01T00:00:00.000Z");
      const epermErr = Object.assign(new Error("EPERM"), { code: "EPERM" });
      let renameCalls = 0;

      const mockFs: FileSystemPort = {
        ...nodeFileSystem,
        rename: async (from, to) => {
          renameCalls++;
          if (renameCalls === 1) throw epermErr;
          await nodeFileSystem.rename(from, to);
        },
      };

      await saveState(filePath, state, mockFs);
      const loaded = await loadState(filePath);
      expect(loaded.agents["my-app"].agentId).toBe("agent-1");
      expect(renameCalls).toBe(2);
    });
  });

  it("retries rename on EACCES error", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      const state = addAgentToState(createEmptyState(), "my-app", "agent-1", "2026-01-01T00:00:00.000Z");
      const eaccessErr = Object.assign(new Error("EACCES"), { code: "EACCES" });
      let renameCalls = 0;

      const mockFs: FileSystemPort = {
        ...nodeFileSystem,
        rename: async (from, to) => {
          renameCalls++;
          if (renameCalls === 1) throw eaccessErr;
          await nodeFileSystem.rename(from, to);
        },
      };

      await saveState(filePath, state, mockFs);
      expect(renameCalls).toBe(2);
    });
  });

  it("does not retry rename on non-transient errors", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      const state = addAgentToState(createEmptyState(), "my-app", "agent-1", "2026-01-01T00:00:00.000Z");
      const genericErr = new Error("generic error");
      let renameCalls = 0;

      const mockFs: FileSystemPort = {
        ...nodeFileSystem,
        rename: async () => {
          renameCalls++;
          throw genericErr;
        },
      };

      await expect(saveState(filePath, state, mockFs)).rejects.toThrow("generic error");
      expect(renameCalls).toBe(1);
    });
  });

  it("retries rename up to retries limit on persistent transient errors", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      const state = addAgentToState(createEmptyState(), "my-app", "agent-1", "2026-01-01T00:00:00.000Z");
      const busyErr = Object.assign(new Error("busy"), { code: "EBUSY" });
      let renameCalls = 0;

      const mockFs: FileSystemPort = {
        ...nodeFileSystem,
        rename: async () => {
          renameCalls++;
          throw busyErr;
        },
      };

      // Default retries=3, so 1 initial + 3 retries = 4 calls max
      await expect(saveState(filePath, state, mockFs)).rejects.toThrow("busy");
      expect(renameCalls).toBe(4);
    });
  });

  it("loadState re-throws non-ENOENT fs errors from readFile", async () => {
    const eaccessErr = Object.assign(new Error("EACCES"), { code: "EACCES" });
    const mockFs: FileSystemPort = {
      ...nodeFileSystem,
      readFile: async () => { throw eaccessErr; },
    };
    await expect(loadState("/some/path.json", mockFs)).rejects.toThrow("EACCES");
  });

  it("isTransientRenameError returns false for non-error values", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      const state = addAgentToState(createEmptyState(), "my-app", "agent-1", "2026-01-01T00:00:00.000Z");
      let renameCalls = 0;

      const mockFs: FileSystemPort = {
        ...nodeFileSystem,
        rename: async (from, to) => {
          renameCalls++;
          // Throw a non-object error on first call (string) — not transient
          if (renameCalls === 1) throw "string error";
          await nodeFileSystem.rename(from, to);
        },
      };

      // Non-object error is not transient, should not retry
      await expect(saveState(filePath, state, mockFs)).rejects.toBe("string error");
      expect(renameCalls).toBe(1);
    });
  });

  it("migrateLegacyState handles non-object raw (passes through without stateVersion injection)", async () => {
    // A number JSON value like `42` is not an object, so migrateLegacyState returns it as-is
    // → schema parse will fail → StateFileError
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      await fs.writeFile(filePath, "42", "utf-8");
      await expect(loadState(filePath)).rejects.toThrow("Invalid state file");
    });
  });

  it("migrateLegacyState with object that has no stateVersion injects STATE_SCHEMA_VERSION", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      // No stateVersion → migrateLegacyState injects it
      const legacy = {
        agents: {
          "my-app": {
            agentId: "agent-legacy",
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
      expect(loaded.agents["my-app"].agentId).toBe("agent-legacy");
    });
  });

  it("isTransientRenameError returns false for null err.code (not EBUSY/EPERM/EACCES)", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      const state = addAgentToState(createEmptyState(), "my-app", "agent-1", "2026-01-01T00:00:00.000Z");
      const nullCodeErr = Object.assign(new Error("null code"), { code: null });
      let renameCalls = 0;

      const mockFs: FileSystemPort = {
        ...nodeFileSystem,
        rename: async () => {
          renameCalls++;
          throw nullCodeErr;
        },
      };

      // null code is not a transient code, should not retry
      await expect(saveState(filePath, state, mockFs)).rejects.toThrow("null code");
      expect(renameCalls).toBe(1);
    });
  });

  it("isTransientRenameError returns false when err has no code property", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      const state = addAgentToState(createEmptyState(), "my-app", "agent-1", "2026-01-01T00:00:00.000Z");
      const noCodeErr = new Error("no code property");
      let renameCalls = 0;

      const mockFs: FileSystemPort = {
        ...nodeFileSystem,
        rename: async () => {
          renameCalls++;
          throw noCodeErr;
        },
      };

      // No code property → not transient, no retry
      await expect(saveState(filePath, state, mockFs)).rejects.toThrow("no code property");
      expect(renameCalls).toBe(1);
    });
  });

  it("renameWithRetry stops retrying at retries limit (not before)", async () => {
    // retries=3 means 1 initial + 3 retries = 4 total; should stop at 4, not at 3
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      const state = addAgentToState(createEmptyState(), "my-app", "agent-1", "2026-01-01T00:00:00.000Z");
      const busyErr = Object.assign(new Error("busy"), { code: "EBUSY" });
      let renameCalls = 0;

      const mockFs: FileSystemPort = {
        ...nodeFileSystem,
        rename: async (from, to) => {
          renameCalls++;
          // Succeed on the 4th call (attempt === retries === 3)
          if (renameCalls === 4) {
            await nodeFileSystem.rename(from, to);
            return;
          }
          throw busyErr;
        },
      };

      await saveState(filePath, state, mockFs);
      const loaded = await loadState(filePath);
      expect(loaded.agents["my-app"].agentId).toBe("agent-1");
      expect(renameCalls).toBe(4);
    });
  });

  it("loadState handles ENOENT specifically (not other error codes)", async () => {
    // ENOENT → returns empty state (not throwing)
    const enoentErr = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const mockFs: FileSystemPort = {
      ...nodeFileSystem,
      readFile: async () => { throw enoentErr; },
    };
    const state = await loadState("/some/path.json", mockFs);
    expect(state.stateVersion).toBe(STATE_SCHEMA_VERSION);
    expect(state.agents).toEqual({});
  });

  it("loadState re-throws StateFileError without backup re-creation", async () => {
    // First call creates a backup and throws StateFileError
    // But re-throwing an existing StateFileError should not create another backup
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      // Use an unsupported version to trigger the StateFileError path
      const unsupported = { stateVersion: 999, agents: {} };
      await fs.writeFile(filePath, JSON.stringify(unsupported), "utf-8");

      await expect(loadState(filePath)).rejects.toThrow("unsupported state version");
      const files = await fs.readdir(dir);
      const backups = files.filter((name) => name.startsWith("state.json.bak."));
      // Exactly one backup — not two
      expect(backups.length).toBe(1);
    });
  });

  it("loadState wraps SyntaxError (not ZodError) in StateFileError", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      await fs.writeFile(filePath, "definitely { not } json", "utf-8");
      try {
        await loadState(filePath);
        expect.fail("Should have thrown");
      } catch (error) {
        expect((error as Error).name).toBe("StateFileError");
        expect((error as Error).message).toContain("Invalid state file");
      }
    });
  });

  it("ZodError with empty path falls back to 'root' location", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      // A JSON string (not object) produces a ZodError with path=[] (root), triggering || "root" fallback
      await fs.writeFile(filePath, '"not-an-object"', "utf-8");
      try {
        await loadState(filePath);
        expect.fail("Should have thrown");
      } catch (error) {
        expect((error as Error).message).toContain('at "root"');
      }
    });
  });

  it("ZodError location uses dot-joined path (not empty string join)", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      // agentId must be a string, but we pass a number to force ZodError
      const invalid = {
        agents: {
          "my-app": { agentId: 123, repoName: "my-app" },
        },
      };
      await fs.writeFile(filePath, JSON.stringify(invalid), "utf-8");
      try {
        await loadState(filePath);
        expect.fail("Should have thrown");
      } catch (error) {
        const message = (error as Error).message;
        // Location should use "." join like "agents.my-app.agentId"
        expect(message).toContain("Invalid state file");
        // Should not be just "root" for a nested path
        expect(message).not.toContain("at \"root\":");
      }
    });
  });

  it("agentState default for createdAt is empty string when missing", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "state.json");
      const minimal = {
        agents: {
          "my-app": {
            agentId: "agent-1",
            repoName: "my-app",
            // no createdAt
          },
        },
      };
      await fs.writeFile(filePath, JSON.stringify(minimal), "utf-8");
      const loaded = await loadState(filePath);
      // createdAt defaults to ""
      expect(loaded.agents["my-app"].createdAt).toBe("");
    });
  });

  it("loadState reads file using utf8 encoding", async () => {
    let capturedEncoding: string | undefined;
    const mockFs: FileSystemPort = {
      ...nodeFileSystem,
      readFile: async (_path, encoding) => {
        capturedEncoding = encoding as string;
        return JSON.stringify({ agents: {} });
      },
    };

    await loadState("/some/path.json", mockFs);
    expect(capturedEncoding).toBe("utf8");
  });
});
