/**
 * Stryker-safe tests for init.ts — port-injected only (no process.chdir).
 * These are duplicated here from init.test.ts so Stryker can run them in sandbox workers.
 */
import { describe, it, expect, vi } from "vitest";
import type { FileSystemPort, WatcherHandle } from "../ports/filesystem.js";
import { runInit } from "./init.js";
import type * as readline from "node:readline/promises";

function makeFakeFs(files: Record<string, string> = {}): FileSystemPort & { store: Map<string, string> } {
  const store = new Map(Object.entries(files));
  return {
    store,
    readFile: async (p) => {
      const v = store.get(p);
      if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return v;
    },
    writeFile: async (p, d) => { store.set(p, d); },
    stat: async (p) => {
      const v = store.get(p);
      if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return { size: v.length, isDirectory: () => v === "__DIR__" };
    },
    access: async (p) => {
      if (!store.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    rename: async (from, to) => {
      const v = store.get(from);
      if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      store.delete(from);
      store.set(to, v);
    },
    copyFile: async (src, dest) => {
      const v = store.get(src);
      if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      store.set(dest, v);
    },
    glob: async () => ["index.ts", "src/main.ts"],
    watch: () => ({ close: vi.fn(), on: vi.fn().mockReturnThis() } as unknown as WatcherHandle),
  };
}

const mockRl = { question: vi.fn().mockResolvedValue("") } as unknown as readline.Interface;

describe("runInit (port-injected, stryker)", () => {
  it("writes .env when API key provided via flag", async () => {
    delete process.env.LETTA_API_KEY;
    const fakeFs = makeFakeFs({
      "/repo": "__DIR__",
      "/repo/.git": "__DIR__",
    });

    await runInit(mockRl, {
      apiKey: "sk-test-key",
      repoPath: "/repo",
      assumeYes: true,
      allowPrompts: false,
      cwd: "/project",
      fs: fakeFs,
    });

    expect(fakeFs.store.get("/project/.env")).toContain("sk-test-key");
  });

  it("writes config.yaml with detected repo name", async () => {
    delete process.env.LETTA_API_KEY;
    const fakeFs = makeFakeFs({
      "/repo": "__DIR__",
      "/repo/.git": "__DIR__",
    });

    const result = await runInit(mockRl, {
      apiKey: "sk-test-key",
      repoPath: "/repo",
      assumeYes: true,
      allowPrompts: false,
      cwd: "/project",
      fs: fakeFs,
    });

    expect(result.repoName).toBe("repo");
    expect(fakeFs.store.has("/project/config.yaml")).toBe(true);
  });

  it("throws when repo path is not a directory", async () => {
    const fakeFs = makeFakeFs({ "/repo": "not-a-dir" });

    await expect(
      runInit(mockRl, { repoPath: "/repo", assumeYes: true, allowPrompts: false, cwd: "/project", fs: fakeFs }),
    ).rejects.toThrow();
  });

  it("throws Not a git repository when .git is missing", async () => {
    delete process.env.LETTA_API_KEY;
    const fakeFs = makeFakeFs({
      "/repo": "__DIR__",
    });

    await expect(
      runInit(mockRl, {
        apiKey: "sk-key",
        repoPath: "/repo",
        assumeYes: true,
        allowPrompts: false,
        cwd: "/project",
        fs: fakeFs,
      }),
    ).rejects.toThrow("Not a git repository");
  });

  it("envWritten is null when API key already in environment", async () => {
    process.env.LETTA_API_KEY = "existing-key";
    const fakeFs = makeFakeFs({
      "/repo": "__DIR__",
      "/repo/.git": "__DIR__",
    });

    const result = await runInit(mockRl, {
      repoPath: "/repo",
      assumeYes: true,
      allowPrompts: false,
      cwd: "/project",
      fs: fakeFs,
    });

    expect(result.envPath).toBeNull();
    expect(fakeFs.store.has("/project/.env")).toBe(false);
    process.env.LETTA_API_KEY = undefined;
  });

  it("throws Missing API key when no api key and non-interactive", async () => {
    delete process.env.LETTA_API_KEY;
    const fakeFs = makeFakeFs({
      "/repo": "__DIR__",
      "/repo/.git": "__DIR__",
    });

    await expect(
      runInit(mockRl, {
        repoPath: "/repo",
        assumeYes: true,
        allowPrompts: false,
        cwd: "/project",
        fs: fakeFs,
      }),
    ).rejects.toThrow("Missing API key");
  });

  it("throws Missing repo path when no repo path and non-interactive", async () => {
    delete process.env.LETTA_API_KEY;
    const fakeFs = makeFakeFs({});

    await expect(
      runInit(mockRl, {
        apiKey: "sk-key",
        assumeYes: true,
        allowPrompts: false,
        cwd: "/project",
        fs: fakeFs,
      }),
    ).rejects.toThrow("Missing repo path");
  });

  it("throws Directory not found when directory does not exist", async () => {
    delete process.env.LETTA_API_KEY;
    const fakeFs = makeFakeFs({});

    await expect(
      runInit(mockRl, {
        apiKey: "sk-key",
        repoPath: "/nonexistent",
        assumeYes: true,
        allowPrompts: false,
        cwd: "/project",
        fs: fakeFs,
      }),
    ).rejects.toThrow("Directory not found");
  });

  it("uses description from package.json when available", async () => {
    delete process.env.LETTA_API_KEY;
    const fakeFs = makeFakeFs({
      "/repo": "__DIR__",
      "/repo/.git": "__DIR__",
      "/repo/package.json": JSON.stringify({ description: "My cool library" }),
    });
    fakeFs.glob = async () => ["index.ts"];

    const result = await runInit(mockRl, {
      apiKey: "sk-key",
      repoPath: "/repo",
      assumeYes: true,
      allowPrompts: false,
      cwd: "/project",
      fs: fakeFs,
    });

    const config = fakeFs.store.get("/project/config.yaml");
    expect(config).toContain("My cool library");
    expect(result.repoName).toBe("repo");
  });

  it("aborted by user when confirm is 'n'", async () => {
    delete process.env.LETTA_API_KEY;
    const fakeFs = makeFakeFs({
      "/repo": "__DIR__",
      "/repo/.git": "__DIR__",
    });

    const rl = { question: vi.fn().mockResolvedValue("n") } as unknown as readline.Interface;

    await expect(
      runInit(rl, {
        apiKey: "sk-key",
        repoPath: "/repo",
        assumeYes: false,
        allowPrompts: true,
        cwd: "/project",
        fs: fakeFs,
      }),
    ).rejects.toThrow("Aborted by user");
  });

  it("returns configPath in result", async () => {
    delete process.env.LETTA_API_KEY;
    const fakeFs = makeFakeFs({
      "/repo": "__DIR__",
      "/repo/.git": "__DIR__",
    });

    const result = await runInit(mockRl, {
      apiKey: "sk-key",
      repoPath: "/repo",
      assumeYes: true,
      allowPrompts: false,
      cwd: "/project",
      fs: fakeFs,
    });

    expect(result.configPath).toBe("/project/config.yaml");
  });

  it("uses .env from flag when .env file has placeholder value", async () => {
    delete process.env.LETTA_API_KEY;
    const fakeFs = makeFakeFs({
      "/project/.env": "LETTA_API_KEY=your-key-here\n",
      "/repo": "__DIR__",
      "/repo/.git": "__DIR__",
    });

    await runInit(mockRl, {
      apiKey: "sk-real-key",
      repoPath: "/repo",
      assumeYes: true,
      allowPrompts: false,
      cwd: "/project",
      fs: fakeFs,
    });

    expect(fakeFs.store.get("/project/.env")).toContain("sk-real-key");
  });
});
