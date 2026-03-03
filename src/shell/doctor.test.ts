import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkApiKey, checkConfigFile, checkGit, runAllChecks, runDoctorFixes } from "./doctor.js";
import type { FileSystemPort, WatcherHandle } from "../ports/filesystem.js";
import type { GitPort } from "../ports/git.js";
import type { AgentProvider } from "./provider.js";

const tempDirs: string[] = [];
const originalApiKey = process.env.LETTA_API_KEY;
const originalCwd = process.cwd();

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  process.chdir(originalCwd);
  process.env.LETTA_API_KEY = originalApiKey;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("doctor shell checks", () => {
  it("checkApiKey fails when LETTA_API_KEY is missing", () => {
    delete process.env.LETTA_API_KEY;
    const result = checkApiKey();
    expect(result.status).toBe("fail");
    expect(result.message).toContain("LETTA_API_KEY");
  });

  it("checkApiKey passes when LETTA_API_KEY is set", () => {
    process.env.LETTA_API_KEY = "test-key";
    const result = checkApiKey();
    expect(result.status).toBe("pass");
  });

  it("checkApiKey fails when OPENROUTER_API_KEY is missing for viking provider", () => {
    delete process.env.OPENROUTER_API_KEY;
    const result = checkApiKey("viking");
    expect(result.status).toBe("fail");
    expect(result.message).toContain("OPENROUTER_API_KEY");
  });

  it("checkApiKey passes when OPENROUTER_API_KEY is set for viking provider", () => {
    process.env.OPENROUTER_API_KEY = "or-test";
    const result = checkApiKey("viking");
    expect(result.status).toBe("pass");
  });

  it("checkConfigFile reports missing config", async () => {
    const missingPath = path.join(await makeTempDir("doctor-"), "missing.yaml");
    const result = await checkConfigFile(missingPath);
    expect(result.status).toBe("fail");
    expect(result.message).toContain("not found");
  });

  it("runAllChecks includes config and git checks when config exists", async () => {
    const tempDir = await makeTempDir("doctor-");
    const repoDir = path.join(tempDir, "repo");
    // Path is constrained under the mkdtemp-created test directory.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.mkdir(repoDir, { recursive: true });
    const configPath = path.join(tempDir, "config.yaml");
    const config = [
      "letta:",
      "  model: openai/gpt-4.1",
      "  embedding: openai/text-embedding-3-small",
      "repos:",
      "  my-app:",
      `    path: ${repoDir}`,
      "    description: test repo",
      "    extensions: [.ts]",
      "    ignore_dirs: [node_modules, .git]",
    ].join("\n");
    // Path is constrained under the mkdtemp-created test directory.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.writeFile(configPath, config, "utf8");

    delete process.env.LETTA_API_KEY;
    const results = await runAllChecks(null, configPath);
    const names = results.map((r) => r.name);
    expect(names).toContain("API key");
    expect(names).toContain("Config file");
    expect(names).toContain("Git");
    expect(names).toContain('Repo "my-app"');
  });

  it("runDoctorFixes creates missing config, env, and state", async () => {
    const tempDir = await makeTempDir("doctor-fix-");
    process.chdir(tempDir);
    const configPath = path.join(tempDir, "config.yaml");
    // Path is constrained under the mkdtemp-created test directory.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.writeFile(path.join(tempDir, "config.example.yaml"), "repos: {}\nletta:\n  model: x\n  embedding: y\n", "utf8");

    const result = await runDoctorFixes(configPath);

    expect(result.applied.some((line) => line.includes(".env"))).toBe(true);
    expect(result.applied.some((line) => line.includes("config.example.yaml"))).toBe(true);
    expect(result.applied.some((line) => line.includes(".repo-expert-state.json"))).toBe(true);

    await expect(fs.access(path.join(tempDir, ".env"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tempDir, "config.yaml"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tempDir, ".repo-expert-state.json"))).resolves.toBeUndefined();
  });

  it("runAllChecks prefers agent from configured repos when state has orphan first", async () => {
    const tempDir = await makeTempDir("doctor-");
    process.chdir(tempDir);
    const repoDir = path.join(tempDir, "repo");
    // Path is constrained under the mkdtemp-created test directory.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.mkdir(repoDir, { recursive: true });

    const configPath = path.join(tempDir, "config.yaml");
    // Path is constrained under the mkdtemp-created test directory.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.writeFile(
      configPath,
      [
        "letta:",
        "  model: openai/gpt-4.1",
        "  embedding: openai/text-embedding-3-small",
        "repos:",
        "  configured-repo:",
        `    path: ${repoDir}`,
        "    description: test repo",
        "    extensions: [.ts]",
        "    ignore_dirs: [node_modules, .git]",
      ].join("\n"),
      "utf8",
    );

    const state = {
      stateVersion: 2,
      agents: {
        orphan: {
          agentId: "orphan-agent",
          repoName: "orphan",
          passages: {},
          lastBootstrap: null,
          lastSyncCommit: null,
          lastSyncAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        "configured-repo": {
          agentId: "configured-agent",
          repoName: "configured-repo",
          passages: {},
          lastBootstrap: null,
          lastSyncCommit: null,
          lastSyncAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };
    // Path is constrained under the mkdtemp-created test directory.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.writeFile(path.join(tempDir, ".repo-expert-state.json"), JSON.stringify(state), "utf8");

    const listPassages = vi.fn((agentId: string) => {
      if (agentId === "configured-agent") return Promise.resolve([]);
      return Promise.reject(new Error("should not use orphan agent"));
    });
    const provider = { listPassages } as unknown as AgentProvider;

    const results = await runAllChecks(provider, configPath);
    const apiConnection = results.find((r) => r.name === "API connection");

    expect(listPassages).toHaveBeenCalledTimes(1);
    expect(listPassages).toHaveBeenCalledWith("configured-agent");
    expect(apiConnection?.status).toBe("pass");
  });
});

// Helper: in-memory fake for FileSystemPort
const fakeWatcherHandle = (): WatcherHandle => ({ close: () => {}, on: () => ({}) }) as WatcherHandle;

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
      const value = store.get(p);
      if (value !== undefined) return Promise.resolve({ size: value.length, isDirectory: () => false });
      return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
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
    glob: () => Promise.resolve([]),
    watch: fakeWatcherHandle,
  };
}

function makeFakeGit(overrides: Partial<GitPort> = {}): GitPort {
  return {
    submoduleStatus: () => "",
    version: () => "git version 2.39.0",
    headCommit: () => "abc123",
    diffFiles: () => [],
    ...overrides,
  };
}

describe("checkConfigFile (port-injected)", () => {
  it("returns pass when config file exists", async () => {
    const fakeFs = makeFakeFs({ "/project/config.yaml": "repos: {}" });
    const result = await checkConfigFile("/project/config.yaml", fakeFs);
    expect(result.status).toBe("pass");
    expect(result.name).toBe("Config file");
  });

  it("returns fail when config file does not exist", async () => {
    const fakeFs = makeFakeFs({});
    const result = await checkConfigFile("/project/config.yaml", fakeFs);
    expect(result.status).toBe("fail");
    expect(result.message).toContain("repo-expert init");
  });
});

describe("checkGit (port-injected)", () => {
  it("returns pass when git is available", () => {
    const fakeGit = makeFakeGit({ version: () => "git version 2.39.0" });
    const result = checkGit(fakeGit);
    expect(result.status).toBe("pass");
    expect(result.message).toBe("git version 2.39.0");
  });

  it("returns fail when git throws", () => {
    const fakeGit = makeFakeGit({ version: () => { throw new Error("not found"); } });
    const result = checkGit(fakeGit);
    expect(result.status).toBe("fail");
    expect(result.message).toContain("not found");
  });
});

describe("runDoctorFixes (port-injected)", () => {
  it("creates .env when missing", async () => {
    const fakeFs = makeFakeFs({});
    await runDoctorFixes("/project/config.yaml", "/project", fakeFs);
    expect(fakeFs.store.get("/project/.env")).toContain("LETTA_API_KEY");
    expect(fakeFs.store.has("/project/.repo-expert-state.json")).toBe(true);
  });

  it("creates OpenRouter .env template when provider is viking", async () => {
    const fakeFs = makeFakeFs({
      "/project/config.yaml": [
        "provider:",
        "  type: viking",
        "  openrouter_model: openai/gpt-4o-mini",
        "repos:",
        "  demo:",
        "    path: /repo",
        "    description: test",
        "    extensions: [.ts]",
        "    ignore_dirs: [node_modules, .git]",
      ].join("\n"),
    });
    await runDoctorFixes("/project/config.yaml", "/project", fakeFs);
    expect(fakeFs.store.get("/project/.env")).toContain("OPENROUTER_API_KEY");
  });

  it("does not overwrite existing .env", async () => {
    const fakeFs = makeFakeFs({ "/project/.env": "LETTA_API_KEY=real-key\n" });
    const result = await runDoctorFixes("/project/config.yaml", "/project", fakeFs);
    expect(fakeFs.store.get("/project/.env")).toBe("LETTA_API_KEY=real-key\n");
    expect(result.applied.every((s) => !s.includes(".env"))).toBe(true);
  });

  it("copies config.example.yaml when config missing and example exists", async () => {
    const fakeFs = makeFakeFs({ "/project/config.example.yaml": "repos: {}" });
    await runDoctorFixes("/project/config.yaml", "/project", fakeFs);
    expect(fakeFs.store.has("/project/config.yaml")).toBe(true);
  });

  it("adds suggestion when config and example both missing", async () => {
    const fakeFs = makeFakeFs({});
    const result = await runDoctorFixes("/project/config.yaml", "/project", fakeFs);
    expect(result.suggestions.some((s) => s.includes("repo-expert init"))).toBe(true);
  });
});
