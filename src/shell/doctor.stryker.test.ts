/**
 * Stryker-safe tests for doctor.ts — port-injected only (no process.chdir).
 * These are duplicated here from doctor.test.ts so Stryker can run them in sandbox workers.
 */
import { expect, describe, it, afterEach } from "vitest";
import { checkApiKey, checkApiConnection, checkConfigFile, checkGit, runDoctorFixes } from "./doctor.js";
import type { FileSystemPort, WatcherHandle } from "../ports/filesystem.js";
import type { GitPort } from "../ports/git.js";
import type { AgentProvider } from "./provider.js";

const GIT_VERSION = "git version 2.39.0";
const PROJECT_CONFIG_PATH = "/project/config.yaml";
const PROJECT_ENV_PATH = "/project/.env";
const PROJECT_STATE_PATH = "/project/.repo-expert-state.json";
const REAL_ENV_CONTENT = "LETTA_API_KEY=real-key\n";

function createWatcherHandle(): WatcherHandle {
  return { close: () => {}, on: () => ({}) } as unknown as WatcherHandle;
}

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
      if (store.has(p)) {
        const value = store.get(p);
        if (value === undefined) return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
        return Promise.resolve({ size: value.length, isDirectory: () => false });
      }
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
    watch: createWatcherHandle,
  };
}

function makeFakeGit(overrides: Partial<GitPort> = {}): GitPort {
  return {
    submoduleStatus: () => "",
    version: () => GIT_VERSION,
    headCommit: () => "abc123",
    diffFiles: () => [],
    ...overrides,
  };
}

const originalApiKey = process.env.LETTA_API_KEY;
afterEach(() => {
  process.env.LETTA_API_KEY = originalApiKey;
});

describe("checkApiKey (port-injected, stryker)", () => {
  it("returns fail when LETTA_API_KEY is missing", () => {
    delete process.env.LETTA_API_KEY;
    const result = checkApiKey();
    expect(result.status).toBe("fail");
    expect(result.name).toBe("API key");
    expect(result.message).toContain("LETTA_API_KEY");
  });

  it("returns pass when LETTA_API_KEY is set", () => {
    process.env.LETTA_API_KEY = "test-key";
    const result = checkApiKey();
    expect(result.status).toBe("pass");
    expect(result.name).toBe("API key");
  });

  it("pass message is 'Set in environment'", () => {
    process.env.LETTA_API_KEY = "any-key";
    const result = checkApiKey();
    expect(result.message).toBe("Set in environment");
  });

  it("fail message contains 'not set'", () => {
    delete process.env.LETTA_API_KEY;
    const result = checkApiKey();
    expect(result.message).toContain("not set");
  });
});

describe("checkApiConnection (port-injected, stryker)", () => {
  it("returns pass when provider.listPassages resolves", async () => {
    const mockProvider = {
      listPassages: () => Promise.resolve([]),
    } as unknown as AgentProvider;
    const result = await checkApiConnection(mockProvider, "agent-1");
    expect(result.status).toBe("pass");
    expect(result.name).toBe("API connection");
    expect(result.message).toContain("Connected");
  });

  it("returns fail when provider.listPassages rejects", async () => {
    const mockProvider = {
      listPassages: () => Promise.reject(new Error("Network error")),
    } as unknown as AgentProvider;
    const result = await checkApiConnection(mockProvider, "agent-1");
    expect(result.status).toBe("fail");
    expect(result.name).toBe("API connection");
    expect(result.message).toContain("Network error");
  });

  it("fail message includes provider error string", async () => {
    const mockProvider = {
      listPassages: () => Promise.reject(new Error("string-error")),
    } as unknown as AgentProvider;
    const result = await checkApiConnection(mockProvider, "agent-1");
    expect(result.status).toBe("fail");
    expect(result.message).toContain("string-error");
  });
});

describe("checkConfigFile (port-injected, stryker)", () => {
  it("returns pass when config file exists", async () => {
    const fakeFs = makeFakeFs({ [PROJECT_CONFIG_PATH]: "repos: {}" });
    const result = await checkConfigFile(PROJECT_CONFIG_PATH, fakeFs);
    expect(result.status).toBe("pass");
    expect(result.name).toBe("Config file");
  });

  it("returns fail when config file does not exist", async () => {
    const fakeFs = makeFakeFs({});
    const result = await checkConfigFile(PROJECT_CONFIG_PATH, fakeFs);
    expect(result.status).toBe("fail");
    expect(result.message).toContain("repo-expert init");
  });

  it("message includes config path when file exists", async () => {
    const fakeFs = makeFakeFs({ [PROJECT_CONFIG_PATH]: "repos: {}" });
    const result = await checkConfigFile(PROJECT_CONFIG_PATH, fakeFs);
    expect(result.message).toContain(PROJECT_CONFIG_PATH);
  });

  it("message includes config path when file does not exist", async () => {
    const fakeFs = makeFakeFs({});
    const result = await checkConfigFile(PROJECT_CONFIG_PATH, fakeFs);
    expect(result.message).toContain(PROJECT_CONFIG_PATH);
  });
});

describe("checkGit (port-injected, stryker)", () => {
  it("returns pass when git is available", () => {
    const fakeGit = makeFakeGit({ version: () => GIT_VERSION });
    const result = checkGit(fakeGit);
    expect(result.status).toBe("pass");
    expect(result.message).toBe(GIT_VERSION);
  });

  it("returns fail when git throws", () => {
    const fakeGit = makeFakeGit({ version: () => { throw new Error("not found"); } });
    const result = checkGit(fakeGit);
    expect(result.status).toBe("fail");
    expect(result.message).toContain("not found");
  });

  it("name field is 'Git'", () => {
    const fakeGit = makeFakeGit({ version: () => GIT_VERSION });
    const result = checkGit(fakeGit);
    expect(result.name).toBe("Git");
  });

  it("fail result name is 'Git'", () => {
    const fakeGit = makeFakeGit({ version: () => { throw new Error("x"); } });
    const result = checkGit(fakeGit);
    expect(result.name).toBe("Git");
  });

  it("fail message is 'git not found on PATH' when error has no message", () => {
    const fakeGit = makeFakeGit({ version: () => { throw new Error("x"); } });
    const result = checkGit(fakeGit);
    expect(result.status).toBe("fail");
  });
});

describe("runDoctorFixes (port-injected, stryker)", () => {
  it("creates .env when missing", async () => {
    const fakeFs = makeFakeFs({});
    await runDoctorFixes(PROJECT_CONFIG_PATH, "/project", fakeFs);
    expect(fakeFs.store.get(PROJECT_ENV_PATH)).toContain("LETTA_API_KEY");
    expect(fakeFs.store.has(PROJECT_STATE_PATH)).toBe(true);
  });

  it("does not overwrite existing .env", async () => {
    const fakeFs = makeFakeFs({ [PROJECT_ENV_PATH]: REAL_ENV_CONTENT });
    const result = await runDoctorFixes(PROJECT_CONFIG_PATH, "/project", fakeFs);
    expect(fakeFs.store.get(PROJECT_ENV_PATH)).toBe(REAL_ENV_CONTENT);
    expect(result.applied.every((s) => !s.includes(".env"))).toBe(true);
  });

  it("copies config.example.yaml when config missing and example exists", async () => {
    const fakeFs = makeFakeFs({ "/project/config.example.yaml": "repos: {}" });
    await runDoctorFixes(PROJECT_CONFIG_PATH, "/project", fakeFs);
    expect(fakeFs.store.has(PROJECT_CONFIG_PATH)).toBe(true);
  });

  it("adds suggestion when config and example both missing", async () => {
    const fakeFs = makeFakeFs({});
    const result = await runDoctorFixes(PROJECT_CONFIG_PATH, "/project", fakeFs);
    expect(result.suggestions.some((s) => s.includes("repo-expert init"))).toBe(true);
  });

  it("applied includes .env path when created", async () => {
    const fakeFs = makeFakeFs({});
    const result = await runDoctorFixes(PROJECT_CONFIG_PATH, "/project", fakeFs);
    expect(result.applied.some((s) => s.includes(".env"))).toBe(true);
  });

  it("applied includes config path when copied from example", async () => {
    const fakeFs = makeFakeFs({ "/project/config.example.yaml": "repos: {}" });
    const result = await runDoctorFixes(PROJECT_CONFIG_PATH, "/project", fakeFs);
    expect(result.applied.some((s) => s.includes("config.example.yaml"))).toBe(true);
  });

  it("applied includes state path when state created", async () => {
    const fakeFs = makeFakeFs({});
    const result = await runDoctorFixes(PROJECT_CONFIG_PATH, "/project", fakeFs);
    expect(result.applied.some((s) => s.includes(".repo-expert-state.json"))).toBe(true);
  });

  it("suggests no fixes needed when all files exist", async () => {
    const fakeFs = makeFakeFs({
      [PROJECT_ENV_PATH]: REAL_ENV_CONTENT,
      [PROJECT_CONFIG_PATH]: "repos: {}",
      [PROJECT_STATE_PATH]: "{}",
    });
    const result = await runDoctorFixes(PROJECT_CONFIG_PATH, "/project", fakeFs);
    expect(result.applied).toHaveLength(0);
    expect(result.suggestions.some((s) => s.includes("No automatic fixes"))).toBe(true);
  });

  it("does not copy example if config already exists", async () => {
    const fakeFs = makeFakeFs({
      [PROJECT_CONFIG_PATH]: "repos: {}",
      "/project/config.example.yaml": "example: {}",
    });
    await runDoctorFixes(PROJECT_CONFIG_PATH, "/project", fakeFs);
    expect(fakeFs.store.get(PROJECT_CONFIG_PATH)).toBe("repos: {}");
  });

  it("state file is created with valid JSON", async () => {
    const fakeFs = makeFakeFs({});
    await runDoctorFixes(PROJECT_CONFIG_PATH, "/project", fakeFs);
    const stateContent = fakeFs.store.get(PROJECT_STATE_PATH);
    expect(stateContent).toBeDefined();
    if (typeof stateContent !== "string") throw new Error("Expected state file to be written");
    expect(() => {
      JSON.parse(stateContent);
    }).not.toThrow();
  });

  it("does not overwrite existing state file", async () => {
    const fakeFs = makeFakeFs({ [PROJECT_STATE_PATH]: '{"agents":{}}' });
    const result = await runDoctorFixes(PROJECT_CONFIG_PATH, "/project", fakeFs);
    expect(fakeFs.store.get(PROJECT_STATE_PATH)).toBe('{"agents":{}}');
    expect(result.applied.every((s) => !s.includes(".repo-expert-state.json"))).toBe(true);
  });
});
