import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runInit } from "./init.js";
import type { FileSystemPort, WatcherHandle } from "../ports/filesystem.js";

interface MockRl {
  question(prompt: string): Promise<string>;
}

function makeRl(answers: string[]): MockRl {
  return {
    question: vi.fn(() => Promise.resolve(answers.shift() ?? "")),
  };
}

const tempDirs: string[] = [];
const originalCwd = process.cwd();
const originalApiKey = process.env.LETTA_API_KEY;
const INIT_WORKSPACE_PREFIX = "init-workspace-";
const INDEX_FILE = "index.ts";
const READY_FILE_CONTENT = "export const ready = true;\n";
const CONFIG_YAML_FILE = "config.yaml";
const TEST_LETTA_API_KEY = "test-key";
const FLAG_API_KEY = "sk-test-key";
const PROJECT_ENV_PATH = "/project/.env";
const PROJECT_CONFIG_PATH = "/project/config.yaml";

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function mkdirInWorkspace(directoryPath: string): Promise<void> {
  // Path is constrained under a mkdtemp-created workspace for this test run.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.mkdir(directoryPath, { recursive: true });
}

async function writeWorkspaceFile(filePath: string, content: string): Promise<void> {
  // Path is constrained under a mkdtemp-created workspace for this test run.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.writeFile(filePath, content, "utf8");
}

async function readWorkspaceFile(filePath: string): Promise<string> {
  // Path is constrained under a mkdtemp-created workspace for this test run.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.readFile(filePath, "utf8");
}

afterEach(async () => {
  process.chdir(originalCwd);
  process.env.LETTA_API_KEY = originalApiKey;
  process.exitCode = 0;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe.sequential("runInit", () => {
  it("fails when repo path is not a git repository", async () => {
    const workspace = await makeTempDir(INIT_WORKSPACE_PREFIX);
    const repoDir = path.join(workspace, "repo");
    await mkdirInWorkspace(repoDir);
    await writeWorkspaceFile(path.join(repoDir, "src.ts"), "export const x = 1;\n");

    process.chdir(workspace);
    process.env.LETTA_API_KEY = TEST_LETTA_API_KEY;
    const rl = makeRl(["", repoDir]);

    await expect(runInit(rl)).rejects.toThrow("Not a git repository");
    expect(process.exitCode).toBe(1);
  });

  it("fails when no code extensions are detected", async () => {
    const workspace = await makeTempDir(INIT_WORKSPACE_PREFIX);
    const repoDir = path.join(workspace, "repo");
    await mkdirInWorkspace(path.join(repoDir, ".git"));
    await writeWorkspaceFile(path.join(repoDir, "image.png"), "not-really-a-png");

    process.chdir(workspace);
    process.env.LETTA_API_KEY = TEST_LETTA_API_KEY;
    const rl = makeRl(["", repoDir]);

    await expect(runInit(rl)).rejects.toThrow("No code files detected");
    expect(process.exitCode).toBe(1);
  });

  it("writes config.yaml for a valid git repository", async () => {
    const workspace = await makeTempDir(INIT_WORKSPACE_PREFIX);
    const repoDir = path.join(workspace, "repo");
    await mkdirInWorkspace(path.join(repoDir, ".git"));
    await writeWorkspaceFile(path.join(repoDir, INDEX_FILE), READY_FILE_CONTENT);

    process.chdir(workspace);
    process.env.LETTA_API_KEY = TEST_LETTA_API_KEY;
    const rl = makeRl(["", repoDir, "", "y"]);

    const result = await runInit(rl);
    expect(result.repoName).toBe("repo");
    const configPath = path.join(workspace, CONFIG_YAML_FILE);
    const config = await readWorkspaceFile(configPath);
    expect(config).toContain("repo:");
    expect(config).toContain(".ts");
  });

  it("supports non-interactive options without prompts", async () => {
    const workspace = await makeTempDir(INIT_WORKSPACE_PREFIX);
    const repoDir = path.join(workspace, "repo");
    await mkdirInWorkspace(path.join(repoDir, ".git"));
    await writeWorkspaceFile(path.join(repoDir, INDEX_FILE), READY_FILE_CONTENT);

    process.chdir(workspace);
    delete process.env.LETTA_API_KEY;
    const rl = makeRl([]);

    const result = await runInit(rl, {
      apiKey: "abc123",
      repoPath: repoDir,
      assumeYes: true,
      allowPrompts: false,
    });

    expect(result.repoName).toBe("repo");
    await expect(fs.access(path.join(workspace, ".env"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(workspace, CONFIG_YAML_FILE))).resolves.toBeUndefined();
  });

  it("supports viking provider with --provider in non-interactive mode", async () => {
    const workspace = await makeTempDir("init-workspace-viking-");
    const repoDir = path.join(workspace, "repo");
    await mkdirInWorkspace(path.join(repoDir, ".git"));
    await writeWorkspaceFile(path.join(repoDir, INDEX_FILE), READY_FILE_CONTENT);

    process.chdir(workspace);
    delete process.env.OPENROUTER_API_KEY;
    const rl = makeRl([]);

    await runInit(rl, {
      provider: "viking",
      apiKey: "or-abc123",
      repoPath: repoDir,
      assumeYes: true,
      allowPrompts: false,
    });

    const envContent = await readWorkspaceFile(path.join(workspace, ".env"));
    const configContent = await readWorkspaceFile(path.join(workspace, CONFIG_YAML_FILE));
    expect(envContent).toContain("OPENROUTER_API_KEY=or-abc123");
    expect(configContent).toContain("type: viking");
  });
});

function makeFakeFs(files: Record<string, string> = {}): FileSystemPort & { store: Map<string, string> } {
  const store = new Map(Object.entries(files));
  return {
    store,
    readFile: (p) => {
      const v = store.get(p);
      if (v === undefined) return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
      return Promise.resolve(v);
    },
    writeFile: (p, d) => {
      store.set(p, d);
      return Promise.resolve();
    },
    stat: (p) => {
      const v = store.get(p);
      if (v === undefined) return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
      return Promise.resolve({ size: v.length, isDirectory: () => v === "__DIR__" });
    },
    access: (p) => {
      if (!store.has(p)) return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
      return Promise.resolve();
    },
    rename: (from, to) => {
      const v = store.get(from);
      if (v === undefined) return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
      store.delete(from);
      store.set(to, v);
      return Promise.resolve();
    },
    copyFile: (src, dest) => {
      const v = store.get(src);
      if (v === undefined) return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
      store.set(dest, v);
      return Promise.resolve();
    },
    glob: () => Promise.resolve(["index.ts", "src/main.ts"]),
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
    const rl: MockRl = { question: vi.fn().mockResolvedValue("") };

    await runInit(rl, {
      apiKey: FLAG_API_KEY,
      repoPath: "/repo",
      assumeYes: true,
      allowPrompts: false,
      cwd: "/project",
      fs: fakeFs,
    });

    expect(fakeFs.store.get(PROJECT_ENV_PATH)).toContain(FLAG_API_KEY);
  });

  it("writes config.yaml with detected repo name", async () => {
    delete process.env.LETTA_API_KEY;
    const fakeFs = makeFakeFs({
      "/repo": "__DIR__",
      "/repo/.git": "__DIR__",
    });
    const rl: MockRl = { question: vi.fn().mockResolvedValue("") };

    const result = await runInit(rl, {
      apiKey: FLAG_API_KEY,
      repoPath: "/repo",
      assumeYes: true,
      allowPrompts: false,
      cwd: "/project",
      fs: fakeFs,
    });

    expect(result.repoName).toBe("repo");
    expect(fakeFs.store.has(PROJECT_CONFIG_PATH)).toBe(true);
  });

  it("throws when repo path is not a directory", async () => {
    const fakeFs = makeFakeFs({ "/repo": "not-a-dir" }); // stat returns isDirectory() = false
    const rl: MockRl = { question: vi.fn().mockResolvedValue("") };

    await expect(
      runInit(rl, { repoPath: "/repo", assumeYes: true, allowPrompts: false, cwd: "/project", fs: fakeFs }),
    ).rejects.toThrow();
  });
});
