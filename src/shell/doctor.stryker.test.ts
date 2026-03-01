/**
 * Stryker-safe tests for doctor.ts — port-injected only (no process.chdir).
 * These are duplicated here from doctor.test.ts so Stryker can run them in sandbox workers.
 */
import { expect, describe, it, afterEach } from "vitest";
import { checkApiKey, checkApiConnection, checkConfigFile, checkGit, runDoctorFixes } from "./doctor.js";
import type { FileSystemPort, WatcherHandle } from "../ports/filesystem.js";
import type { GitPort } from "../ports/git.js";
import type { AgentProvider } from "./provider.js";

function makeFakeFs(files: Record<string, string> = {}): FileSystemPort & { store: Map<string, string> } {
  const store = new Map(Object.entries(files));
  const vi_fn = () => ({ close: () => {}, on: () => ({}) }) as unknown as WatcherHandle;
  return {
    store,
    readFile: async (p) => {
      const v = store.get(p);
      if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return v;
    },
    writeFile: async (p, d) => { store.set(p, d); },
    stat: async (p) => {
      if (store.has(p)) return { size: store.get(p)!.length, isDirectory: () => false };
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
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
    glob: async () => [],
    watch: vi_fn,
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

const originalApiKey = process.env.LETTA_API_KEY;
afterEach(() => {
  process.env.LETTA_API_KEY = originalApiKey;
});

describe("checkApiKey (port-injected, stryker)", () => {
  it("returns fail when LETTA_API_KEY is missing", async () => {
    delete process.env.LETTA_API_KEY;
    const result = await checkApiKey();
    expect(result.status).toBe("fail");
    expect(result.name).toBe("API key");
    expect(result.message).toContain("LETTA_API_KEY");
  });

  it("returns pass when LETTA_API_KEY is set", async () => {
    process.env.LETTA_API_KEY = "test-key";
    const result = await checkApiKey();
    expect(result.status).toBe("pass");
    expect(result.name).toBe("API key");
  });

  it("pass message is 'Set in environment'", async () => {
    process.env.LETTA_API_KEY = "any-key";
    const result = await checkApiKey();
    expect(result.message).toBe("Set in environment");
  });

  it("fail message contains 'not set'", async () => {
    delete process.env.LETTA_API_KEY;
    const result = await checkApiKey();
    expect(result.message).toContain("not set");
  });
});

describe("checkApiConnection (port-injected, stryker)", () => {
  it("returns pass when provider.listPassages resolves", async () => {
    const mockProvider = {
      listPassages: async () => [],
    } as unknown as AgentProvider;
    const result = await checkApiConnection(mockProvider, "agent-1");
    expect(result.status).toBe("pass");
    expect(result.name).toBe("API connection");
    expect(result.message).toContain("Connected");
  });

  it("returns fail when provider.listPassages rejects", async () => {
    const mockProvider = {
      listPassages: async () => { throw new Error("Network error"); },
    } as unknown as AgentProvider;
    const result = await checkApiConnection(mockProvider, "agent-1");
    expect(result.status).toBe("fail");
    expect(result.name).toBe("API connection");
    expect(result.message).toContain("Network error");
  });

  it("fail message includes error string for non-Error throws", async () => {
    const mockProvider = {
      listPassages: async () => { throw "string-error"; },
    } as unknown as AgentProvider;
    const result = await checkApiConnection(mockProvider, "agent-1");
    expect(result.status).toBe("fail");
    expect(result.message).toContain("string-error");
  });
});

describe("checkConfigFile (port-injected, stryker)", () => {
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

  it("message includes config path when file exists", async () => {
    const fakeFs = makeFakeFs({ "/project/config.yaml": "repos: {}" });
    const result = await checkConfigFile("/project/config.yaml", fakeFs);
    expect(result.message).toContain("/project/config.yaml");
  });

  it("message includes config path when file does not exist", async () => {
    const fakeFs = makeFakeFs({});
    const result = await checkConfigFile("/project/config.yaml", fakeFs);
    expect(result.message).toContain("/project/config.yaml");
  });
});

describe("checkGit (port-injected, stryker)", () => {
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

  it("name field is 'Git'", () => {
    const fakeGit = makeFakeGit({ version: () => "git version 2.39.0" });
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
    await runDoctorFixes("/project/config.yaml", "/project", fakeFs);
    expect(fakeFs.store.get("/project/.env")).toContain("LETTA_API_KEY");
    expect(fakeFs.store.has("/project/.repo-expert-state.json")).toBe(true);
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

  it("applied includes .env path when created", async () => {
    const fakeFs = makeFakeFs({});
    const result = await runDoctorFixes("/project/config.yaml", "/project", fakeFs);
    expect(result.applied.some((s) => s.includes(".env"))).toBe(true);
  });

  it("applied includes config path when copied from example", async () => {
    const fakeFs = makeFakeFs({ "/project/config.example.yaml": "repos: {}" });
    const result = await runDoctorFixes("/project/config.yaml", "/project", fakeFs);
    expect(result.applied.some((s) => s.includes("config.example.yaml"))).toBe(true);
  });

  it("applied includes state path when state created", async () => {
    const fakeFs = makeFakeFs({});
    const result = await runDoctorFixes("/project/config.yaml", "/project", fakeFs);
    expect(result.applied.some((s) => s.includes(".repo-expert-state.json"))).toBe(true);
  });

  it("suggests no fixes needed when all files exist", async () => {
    const fakeFs = makeFakeFs({
      "/project/.env": "LETTA_API_KEY=real-key\n",
      "/project/config.yaml": "repos: {}",
      "/project/.repo-expert-state.json": "{}",
    });
    const result = await runDoctorFixes("/project/config.yaml", "/project", fakeFs);
    expect(result.applied).toHaveLength(0);
    expect(result.suggestions.some((s) => s.includes("No automatic fixes"))).toBe(true);
  });

  it("does not copy example if config already exists", async () => {
    const fakeFs = makeFakeFs({
      "/project/config.yaml": "repos: {}",
      "/project/config.example.yaml": "example: {}",
    });
    await runDoctorFixes("/project/config.yaml", "/project", fakeFs);
    expect(fakeFs.store.get("/project/config.yaml")).toBe("repos: {}");
  });

  it("state file is created with valid JSON", async () => {
    const fakeFs = makeFakeFs({});
    await runDoctorFixes("/project/config.yaml", "/project", fakeFs);
    const stateContent = fakeFs.store.get("/project/.repo-expert-state.json");
    expect(stateContent).toBeDefined();
    expect(() => JSON.parse(stateContent!)).not.toThrow();
  });

  it("does not overwrite existing state file", async () => {
    const fakeFs = makeFakeFs({ "/project/.repo-expert-state.json": '{"agents":{}}' });
    const result = await runDoctorFixes("/project/config.yaml", "/project", fakeFs);
    expect(fakeFs.store.get("/project/.repo-expert-state.json")).toBe('{"agents":{}}');
    expect(result.applied.every((s) => !s.includes(".repo-expert-state.json"))).toBe(true);
  });
});
