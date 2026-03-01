import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as readline from "node:readline/promises";
import { runInit } from "./init.js";
import type { FileSystemPort, WatcherHandle } from "../ports/filesystem.js";

interface MockRl extends Pick<readline.Interface, "question"> {}

function makeRl(answers: string[]): MockRl {
  return {
    question: vi.fn(async () => answers.shift() ?? ""),
  };
}

const tempDirs: string[] = [];
const originalCwd = process.cwd();
const originalApiKey = process.env.LETTA_API_KEY;

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  process.chdir(originalCwd);
  process.env.LETTA_API_KEY = originalApiKey;
  process.exitCode = 0;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe.sequential("runInit", () => {
  it("fails when repo path is not a git repository", async () => {
    const workspace = await makeTempDir("init-workspace-");
    const repoDir = path.join(workspace, "repo");
    await fs.mkdir(repoDir, { recursive: true });
    await fs.writeFile(path.join(repoDir, "src.ts"), "export const x = 1;\n", "utf-8");

    process.chdir(workspace);
    process.env.LETTA_API_KEY = "test-key";
    const rl = makeRl([repoDir]) as unknown as readline.Interface;

    await expect(runInit(rl)).rejects.toThrow("Not a git repository");
    expect(process.exitCode).toBe(1);
  });

  it("fails when no code extensions are detected", async () => {
    const workspace = await makeTempDir("init-workspace-");
    const repoDir = path.join(workspace, "repo");
    await fs.mkdir(path.join(repoDir, ".git"), { recursive: true });
    await fs.writeFile(path.join(repoDir, "image.png"), "not-really-a-png", "utf-8");

    process.chdir(workspace);
    process.env.LETTA_API_KEY = "test-key";
    const rl = makeRl([repoDir]) as unknown as readline.Interface;

    await expect(runInit(rl)).rejects.toThrow("No code files detected");
    expect(process.exitCode).toBe(1);
  });

  it("writes config.yaml for a valid git repository", async () => {
    const workspace = await makeTempDir("init-workspace-");
    const repoDir = path.join(workspace, "repo");
    await fs.mkdir(path.join(repoDir, ".git"), { recursive: true });
    await fs.writeFile(path.join(repoDir, "index.ts"), "export const ready = true;\n", "utf-8");

    process.chdir(workspace);
    process.env.LETTA_API_KEY = "test-key";
    const rl = makeRl([repoDir, "", "y"]) as unknown as readline.Interface;

    const result = await runInit(rl);
    expect(result.repoName).toBe("repo");
    const configPath = path.join(workspace, "config.yaml");
    const config = await fs.readFile(configPath, "utf8");
    expect(config).toContain("repo:");
    expect(config).toContain(".ts");
  });

  it("supports non-interactive options without prompts", async () => {
    const workspace = await makeTempDir("init-workspace-");
    const repoDir = path.join(workspace, "repo");
    await fs.mkdir(path.join(repoDir, ".git"), { recursive: true });
    await fs.writeFile(path.join(repoDir, "index.ts"), "export const ready = true;\n", "utf-8");

    process.chdir(workspace);
    delete process.env.LETTA_API_KEY;
    const rl = makeRl([]) as unknown as readline.Interface;

    const result = await runInit(rl, {
      apiKey: "abc123",
      repoPath: repoDir,
      assumeYes: true,
      allowPrompts: false,
    });

    expect(result.repoName).toBe("repo");
    await expect(fs.access(path.join(workspace, ".env"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(workspace, "config.yaml"))).resolves.toBeUndefined();
  });
});

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

describe("runInit (port-injected)", () => {
  afterEach(() => {
    process.env.LETTA_API_KEY = originalApiKey;
  });

  it("writes .env when API key provided via flag", async () => {
    delete process.env.LETTA_API_KEY;
    const fakeFs = makeFakeFs({
      "/repo": "__DIR__",
      "/repo/.git": "__DIR__",
    });
    const rl = { question: vi.fn().mockResolvedValue("") } as unknown as import("node:readline/promises").Interface;

    await runInit(rl, {
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
    const rl = { question: vi.fn().mockResolvedValue("") } as unknown as import("node:readline/promises").Interface;

    const result = await runInit(rl, {
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
    const fakeFs = makeFakeFs({ "/repo": "not-a-dir" }); // stat returns isDirectory() = false
    const rl = { question: vi.fn().mockResolvedValue("") } as unknown as import("node:readline/promises").Interface;

    await expect(
      runInit(rl, { repoPath: "/repo", assumeYes: true, allowPrompts: false, cwd: "/project", fs: fakeFs }),
    ).rejects.toThrow();
  });
});
