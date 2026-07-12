import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runInit } from "./init.js";
import type { FileSystemPort, WatcherHandle } from "../ports/filesystem.js";

interface MockRl {
  question(this: void, prompt: string): Promise<string>;
}

function makeRl(answers: string[]): MockRl {
  return {
    question: vi.fn(() => Promise.resolve(answers.shift() ?? "")),
  };
}

const tempDirs: string[] = [];
const originalCwd = process.cwd();
const originalApiKey = process.env.LLM_API_KEY;
const INIT_WORKSPACE_PREFIX = "init-workspace-";
const INDEX_FILE = "index.ts";
const READY_FILE_CONTENT = "export const ready = true;\n";
const CONFIG_YAML_FILE = "config.yaml";
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
  process.env.LLM_API_KEY = originalApiKey;
  process.exitCode = 0;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("runInit", { concurrent: false }, () => {
  it("fails when repo path is not a git repository", async () => {
    const workspace = await makeTempDir(INIT_WORKSPACE_PREFIX);
    const repoDir = path.join(workspace, "repo");
    await mkdirInWorkspace(repoDir);
    await writeWorkspaceFile(path.join(repoDir, "src.ts"), "export const x = 1;\n");

    process.chdir(workspace);
    // answers: model, base URL, embedding engine, repo path
    const rl = makeRl(["", "", "", repoDir]);

    await expect(runInit(rl)).rejects.toThrow("Not a git repository");
    expect(process.exitCode).toBe(1);
  });

  it("fails when no code extensions are detected", async () => {
    const workspace = await makeTempDir(INIT_WORKSPACE_PREFIX);
    const repoDir = path.join(workspace, "repo");
    await mkdirInWorkspace(path.join(repoDir, ".git"));
    await writeWorkspaceFile(path.join(repoDir, "image.png"), "not-really-a-png");

    process.chdir(workspace);
    const rl = makeRl(["", "", "", repoDir]);

    await expect(runInit(rl)).rejects.toThrow("No code files detected");
    expect(process.exitCode).toBe(1);
  });

  it("writes config.yaml for a valid git repository", async () => {
    const workspace = await makeTempDir(INIT_WORKSPACE_PREFIX);
    const repoDir = path.join(workspace, "repo");
    await mkdirInWorkspace(path.join(repoDir, ".git"));
    await writeWorkspaceFile(path.join(repoDir, INDEX_FILE), READY_FILE_CONTENT);

    process.chdir(workspace);
    // answers: model, base URL, embedding engine, repo path, description, confirm
    const rl = makeRl(["", "", "", repoDir, "", "y"]);

    const result = await runInit(rl);
    expect(result.repoName).toBe("repo");
    const configPath = path.join(workspace, CONFIG_YAML_FILE);
    const config = await readWorkspaceFile(configPath);
    expect(config).toContain("repo:");
    expect(config).toContain(".ts");
    expect(config).toContain("model: qwen3-coder:30b");
  });

  it("supports non-interactive options without prompts", async () => {
    const workspace = await makeTempDir(INIT_WORKSPACE_PREFIX);
    const repoDir = path.join(workspace, "repo");
    await mkdirInWorkspace(path.join(repoDir, ".git"));
    await writeWorkspaceFile(path.join(repoDir, INDEX_FILE), READY_FILE_CONTENT);

    process.chdir(workspace);
    delete process.env.LLM_API_KEY;
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

  it("writes an LLM base URL override into config in non-interactive mode", async () => {
    const workspace = await makeTempDir(INIT_WORKSPACE_PREFIX);
    const repoDir = path.join(workspace, "repo");
    await mkdirInWorkspace(path.join(repoDir, ".git"));
    await writeWorkspaceFile(path.join(repoDir, INDEX_FILE), READY_FILE_CONTENT);

    process.chdir(workspace);
    delete process.env.LLM_API_KEY;
    const rl = makeRl([]);

    await runInit(rl, {
      apiKey: "or-abc123",
      repoPath: repoDir,
      model: "llama3.1:8b",
      baseUrl: "https://openrouter.ai/api/v1",
      assumeYes: true,
      allowPrompts: false,
    });

    const envContent = await readWorkspaceFile(path.join(workspace, ".env"));
    const configContent = await readWorkspaceFile(path.join(workspace, CONFIG_YAML_FILE));
    expect(envContent).toContain("LLM_API_KEY=or-abc123");
    expect(configContent).toContain("model: llama3.1:8b");
    expect(configContent).toContain("base_url: https://openrouter.ai/api/v1");
  });

  it("warns (but does not fail) when the chosen LLM endpoint is unreachable", async () => {
    const workspace = await makeTempDir(INIT_WORKSPACE_PREFIX);
    const repoDir = path.join(workspace, "repo");
    await mkdirInWorkspace(path.join(repoDir, ".git"));
    await writeWorkspaceFile(path.join(repoDir, INDEX_FILE), READY_FILE_CONTENT);
    process.chdir(workspace);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    await runInit({ question: vi.fn().mockResolvedValue("") }, {
      repoPath: repoDir,
      assumeYes: true,
      allowPrompts: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalled();
    expect(warnSpy.mock.calls.flat().join(" ")).toContain("ECONNREFUSED");
    warnSpy.mockRestore();
  });

  it("does not warn when the chosen LLM endpoint is reachable", async () => {
    const workspace = await makeTempDir(INIT_WORKSPACE_PREFIX);
    const repoDir = path.join(workspace, "repo");
    await mkdirInWorkspace(path.join(repoDir, ".git"));
    await writeWorkspaceFile(path.join(repoDir, INDEX_FILE), READY_FILE_CONTENT);
    process.chdir(workspace);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 } as unknown as Response);

    await runInit({ question: vi.fn().mockResolvedValue("") }, {
      repoPath: repoDir,
      assumeYes: true,
      allowPrompts: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("prompts for embedding engine and writes transformersjs choice into config.yaml", async () => {
    const workspace = await makeTempDir(INIT_WORKSPACE_PREFIX);
    const repoDir = path.join(workspace, "repo");
    await mkdirInWorkspace(path.join(repoDir, ".git"));
    await writeWorkspaceFile(path.join(repoDir, INDEX_FILE), READY_FILE_CONTENT);
    process.chdir(workspace);

    // answers: model, base URL, embedding engine, repo path, description, confirm
    const rl = makeRl(["", "", "transformersjs", repoDir, "", "y"]);
    await runInit(rl);

    const configContent = await readWorkspaceFile(path.join(workspace, CONFIG_YAML_FILE));
    expect(configContent).toContain("embedding_engine: transformersjs");
  });

  it("defaults embedding engine to http (omitted from config) when --yes is used", async () => {
    const workspace = await makeTempDir(INIT_WORKSPACE_PREFIX);
    const repoDir = path.join(workspace, "repo");
    await mkdirInWorkspace(path.join(repoDir, ".git"));
    await writeWorkspaceFile(path.join(repoDir, INDEX_FILE), READY_FILE_CONTENT);
    process.chdir(workspace);

    await runInit({ question: vi.fn().mockResolvedValue("") }, {
      repoPath: repoDir,
      assumeYes: true,
      allowPrompts: false,
    });

    const configContent = await readWorkspaceFile(path.join(workspace, CONFIG_YAML_FILE));
    expect(configContent).not.toContain("embedding_engine");
  });

  it("rejects when prompts are disallowed and no repo path is supplied (finding 7 guard)", async () => {
    const workspace = await makeTempDir(INIT_WORKSPACE_PREFIX);
    process.chdir(workspace);
    const rl = makeRl([]);

    await expect(runInit(rl, { allowPrompts: false, assumeYes: true })).rejects.toThrow("Missing repo path");
    expect(process.exitCode).toBe(1);
    expect(rl.question).not.toHaveBeenCalled();
  });

  it("honors an --embedding-engine flag override without prompting", async () => {
    const workspace = await makeTempDir(INIT_WORKSPACE_PREFIX);
    const repoDir = path.join(workspace, "repo");
    await mkdirInWorkspace(path.join(repoDir, ".git"));
    await writeWorkspaceFile(path.join(repoDir, INDEX_FILE), READY_FILE_CONTENT);
    process.chdir(workspace);

    await runInit({ question: vi.fn().mockResolvedValue("") }, {
      repoPath: repoDir,
      assumeYes: true,
      allowPrompts: false,
      embeddingEngine: "transformersjs",
    });

    const configContent = await readWorkspaceFile(path.join(workspace, CONFIG_YAML_FILE));
    expect(configContent).toContain("embedding_engine: transformersjs");
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
    process.env.LLM_API_KEY = originalApiKey;
  });

  it("writes .env when API key provided via flag", async () => {
    delete process.env.LLM_API_KEY;
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
    delete process.env.LLM_API_KEY;
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

  it("backs up an existing config.yaml to config.yaml.bak before overwriting", async () => {
    delete process.env.LLM_API_KEY;
    const oldConfig = "repo: old-repo\nmodel: old-model\n";
    const fakeFs = makeFakeFs({
      "/repo": "__DIR__",
      "/repo/.git": "__DIR__",
      [PROJECT_CONFIG_PATH]: oldConfig,
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

    expect(fakeFs.store.get(`${PROJECT_CONFIG_PATH}.bak`)).toBe(oldConfig);
    expect(fakeFs.store.get(PROJECT_CONFIG_PATH)).toContain("repo:");
    expect(fakeFs.store.get(PROJECT_CONFIG_PATH)).not.toBe(oldConfig);
  });

  it("overwrites a previous .bak when config.yaml already existed once before", async () => {
    delete process.env.LLM_API_KEY;
    const staleBak = "repo: stale-bak\n";
    const oldConfig = "repo: current-config\n";
    const fakeFs = makeFakeFs({
      "/repo": "__DIR__",
      "/repo/.git": "__DIR__",
      [PROJECT_CONFIG_PATH]: oldConfig,
      [`${PROJECT_CONFIG_PATH}.bak`]: staleBak,
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

    expect(fakeFs.store.get(`${PROJECT_CONFIG_PATH}.bak`)).toBe(oldConfig);
    expect(fakeFs.store.get(`${PROJECT_CONFIG_PATH}.bak`)).not.toBe(staleBak);
  });

  it("does not create a .bak file when no config.yaml previously existed", async () => {
    delete process.env.LLM_API_KEY;
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

    expect(fakeFs.store.has(`${PROJECT_CONFIG_PATH}.bak`)).toBe(false);
  });
});
