# Hexagonal Architecture Completion — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the 4 remaining shell modules (`doctor`, `init`, `self-check`, `watch`) to dependency-inject ports instead of calling `node:fs` and `node:child_process` directly, move `AgentProvider` to `src/ports/`, and raise the shell Stryker mutation threshold to 70%.

**Architecture:** Wave 1 (parallel) expands the port interfaces and adapters, and moves `AgentProvider`. Wave 2 (parallel, after Wave 1) migrates each shell module to accept optional ports as parameters. Wave 3 raises the Stryker threshold and kills any surviving mutants.

**Tech Stack:** TypeScript strict, Vitest, Stryker, pnpm, hexagonal ports-and-adapters pattern.

---

> **Wave 1 — Tasks 1, 2, 3 are independent and can be done in parallel.**
> **Wave 2 — Tasks 4, 5, 6, 7 depend on Wave 1 completing first.**
> **Wave 3 — Task 8 depends on Wave 2 completing first.**

---

### Task 1: Expand GitPort + nodeGit adapter

**Files:**
- Modify: `src/ports/git.ts`
- Modify: `src/shell/adapters/node-git.ts`
- Modify: `src/shell/adapters/node-git.test.ts`

**Step 1: Add the failing tests for the three new GitPort methods**

Open `src/shell/adapters/node-git.test.ts` and add these test cases after the last existing `it()`:

```typescript
  it("satisfies GitPort interface with all new methods", () => {
    const port: GitPort = nodeGit;
    expect(typeof port.version).toBe("function");
    expect(typeof port.headCommit).toBe("function");
    expect(typeof port.diffFiles).toBe("function");
  });

  it("version calls git --version and returns trimmed output", () => {
    mockedExecFileSync.mockReturnValue("git version 2.39.0\n");
    const result = nodeGit.version();
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["--version"],
      expect.objectContaining({ encoding: "utf8" }),
    );
    expect(result).toBe("git version 2.39.0");
  });

  it("version throws when git is not found", () => {
    mockedExecFileSync.mockImplementation(() => { throw new Error("git not found"); });
    expect(() => nodeGit.version()).toThrow("git not found");
  });

  it("headCommit calls git rev-parse HEAD with correct cwd", () => {
    mockedExecFileSync.mockReturnValue("abc1234567890\n");
    const result = nodeGit.headCommit("/repo");
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "HEAD"],
      expect.objectContaining({ cwd: "/repo", encoding: "utf8" }),
    );
    expect(result).toBe("abc1234567890");
  });

  it("headCommit returns null when git fails", () => {
    mockedExecFileSync.mockImplementation(() => { throw new Error("not a repo"); });
    expect(nodeGit.headCommit("/not-a-repo")).toBeNull();
  });

  it("diffFiles calls git diff --name-only with since..HEAD", () => {
    mockedExecFileSync.mockReturnValue("src/a.ts\nsrc/b.ts\n");
    const result = nodeGit.diffFiles("/repo", "abc123");
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["diff", "--name-only", "abc123..HEAD"],
      expect.objectContaining({ cwd: "/repo", encoding: "utf8" }),
    );
    expect(result).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("diffFiles returns empty array when diff output is empty", () => {
    mockedExecFileSync.mockReturnValue("");
    expect(nodeGit.diffFiles("/repo", "abc123")).toEqual([]);
  });

  it("diffFiles returns null when git fails", () => {
    mockedExecFileSync.mockImplementation(() => { throw new Error("git error"); });
    expect(nodeGit.diffFiles("/repo", "abc123")).toBeNull();
  });
```

**Step 2: Run and confirm red**

```bash
pnpm test src/shell/adapters/node-git.test.ts
```
Expected: failures mentioning `port.version is not a function` etc.

**Step 3: Update the GitPort interface**

Replace the entire contents of `src/ports/git.ts`:

```typescript
export interface GitPort {
  /** Runs `git submodule status` in the given directory and returns raw output. */
  submoduleStatus(repoPath: string): string;
  /** Runs `git --version` and returns the trimmed output. Throws if git is not found. */
  version(): string;
  /** Runs `git rev-parse HEAD` in cwd. Returns null on failure. */
  headCommit(cwd: string): string | null;
  /** Runs `git diff --name-only sinceRef..HEAD`. Returns null on failure, [] if no diff. */
  diffFiles(cwd: string, sinceRef: string): string[] | null;
}
```

**Step 4: Implement the three new methods in nodeGit**

Replace the entire contents of `src/shell/adapters/node-git.ts`:

```typescript
import { execFileSync } from "node:child_process";
import type { GitPort } from "../../ports/git.js";

export const nodeGit: GitPort = {
  submoduleStatus(repoPath: string): string {
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
      return execFileSync("git", ["submodule", "status"], {
        cwd: repoPath,
        encoding: "utf8",
        timeout: 10_000,
      });
    } catch {
      return "";
    }
  },

  version(): string {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
    return execFileSync("git", ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
    }).trim();
  },

  headCommit(cwd: string): string | null {
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
      return execFileSync("git", ["rev-parse", "HEAD"], {
        cwd,
        encoding: "utf8",
        timeout: 10_000,
      }).trim();
    } catch {
      return null;
    }
  },

  diffFiles(cwd: string, sinceRef: string): string[] | null {
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
      const output = execFileSync("git", ["diff", "--name-only", `${sinceRef}..HEAD`], {
        cwd,
        encoding: "utf8",
        timeout: 10_000,
      }).trim();
      return output ? output.split("\n") : [];
    } catch {
      return null;
    }
  },
};
```

**Step 5: Run and confirm green**

```bash
pnpm test src/shell/adapters/node-git.test.ts
```
Expected: all tests pass.

**Step 6: Commit**

```bash
git add src/ports/git.ts src/shell/adapters/node-git.ts src/shell/adapters/node-git.test.ts
git commit -m "feat: expand GitPort with version, headCommit, diffFiles"
```

---

### Task 2: Expand FileSystemPort + nodeFileSystem adapter

**Files:**
- Modify: `src/ports/filesystem.ts`
- Modify: `src/shell/adapters/node-filesystem.ts`
- Modify: `src/shell/adapters/node-filesystem.test.ts`

**Step 1: Add failing tests for `watch` and extended glob options**

Open `src/shell/adapters/node-filesystem.test.ts`. Add these after the last existing test:

```typescript
  it("glob respects onlyFiles option via fast-glob", async () => {
    await withTmpDir(async (dir) => {
      await fs.mkdir(path.join(dir, "sub"), { recursive: true });
      await fs.writeFile(path.join(dir, "sub/file.ts"), "x", "utf8");

      const results = await nodeFileSystem.glob(["**/*"], {
        cwd: dir,
        onlyFiles: true,
        followSymbolicLinks: false,
      });

      expect(results).toContain("sub/file.ts");
      expect(results.every((r) => !r.endsWith("sub"))).toBe(true);
    });
  });

  it("watch calls fs.watch and returns a handle with close and on", () => {
    const handle = nodeFileSystem.watch("/some/path", { recursive: true }, vi.fn());
    expect(typeof handle.close).toBe("function");
    expect(typeof handle.on).toBe("function");
    handle.close();
  });
```

Also add `vi` to the import at the top:
```typescript
import { describe, it, expect, vi } from "vitest";
```

**Step 2: Run and confirm red**

```bash
pnpm test src/shell/adapters/node-filesystem.test.ts
```
Expected: failures on `onlyFiles` test (options ignored) and `watch` test (method missing).

**Step 3: Update FileSystemPort interface**

Replace the entire contents of `src/ports/filesystem.ts`:

```typescript
export interface StatResult {
  size: number;
  isDirectory(): boolean;
}

export interface GlobOptions {
  cwd: string;
  ignore?: string[];
  absolute?: boolean;
  dot?: boolean;
  deep?: number;
  onlyFiles?: boolean;
  followSymbolicLinks?: boolean;
}

export interface WatcherHandle {
  close(): void;
  on(event: "error", listener: (err: Error) => void): this;
}

export interface FileSystemPort {
  readFile(path: string, encoding: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  stat(path: string): Promise<StatResult>;
  access(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  copyFile(src: string, dest: string): Promise<void>;
  glob(patterns: string[], options: GlobOptions): Promise<string[]>;
  watch(
    path: string,
    options: { recursive?: boolean },
    listener: (event: string, filename: string | null) => void,
  ): WatcherHandle;
}
```

**Step 4: Update nodeFileSystem adapter**

Replace the entire contents of `src/shell/adapters/node-filesystem.ts`:

```typescript
import * as fs from "node:fs/promises";
import { watch as fsWatch } from "node:fs";
import fg from "fast-glob";
import type { FileSystemPort, GlobOptions, StatResult, WatcherHandle } from "../../ports/filesystem.js";

export const nodeFileSystem: FileSystemPort = {
  readFile: (path, encoding) => fs.readFile(path, { encoding: encoding as BufferEncoding }),
  writeFile: (path, data) => fs.writeFile(path, data, "utf8"),
  stat: async (path): Promise<StatResult> => {
    const s = await fs.stat(path);
    return { size: s.size, isDirectory: () => s.isDirectory() };
  },
  access: (path) => fs.access(path),
  rename: (from, to) => fs.rename(from, to),
  copyFile: (src, dest) => fs.copyFile(src, dest),
  glob: (patterns, options: GlobOptions) => fg(patterns, options),
  watch: (path, options, listener): WatcherHandle => {
    return fsWatch(path, options, listener);
  },
};
```

**Step 5: Run and confirm green**

```bash
pnpm test src/shell/adapters/node-filesystem.test.ts
```
Expected: all tests pass.

**Step 6: Full suite to catch regressions**

```bash
pnpm test
```
Expected: all tests pass.

**Step 7: Commit**

```bash
git add src/ports/filesystem.ts src/shell/adapters/node-filesystem.ts src/shell/adapters/node-filesystem.test.ts
git commit -m "feat: expand FileSystemPort with watch and extended GlobOptions"
```

---

### Task 3: Move AgentProvider to src/ports/

**Files:**
- Create: `src/ports/agent-provider.ts`
- Modify: `src/shell/provider.ts`

**Step 1: Write failing test for the new port location**

Create `src/ports/agent-provider.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { AgentProvider } from "./agent-provider.js";

describe("AgentProvider port", () => {
  it("can be imported from src/ports/agent-provider", async () => {
    const mod = await import("./agent-provider.js");
    // The module exists and exports nothing (interface-only module)
    expect(mod).toBeDefined();
  });

  it("shell/provider.ts re-exports AgentProvider from the port", async () => {
    const shellMod = await import("../shell/provider.js");
    // If provider.ts re-exports, then it resolves without error
    expect(shellMod).toBeDefined();
  });
});
```

**Step 2: Run and confirm red**

```bash
pnpm test src/ports/agent-provider.test.ts
```
Expected: module not found error.

**Step 3: Create src/ports/agent-provider.ts**

Copy the interface from `src/shell/provider.ts` into the new file:

```typescript
export interface CreateAgentParams {
  name: string;
  repoName: string;
  description: string;
  persona?: string;
  tags: string[];
  model: string;
  embedding: string;
  memoryBlockLimit: number;
  tools?: string[];
}

export interface CreateAgentResult {
  agentId: string;
}

export interface Passage {
  id: string;
  text: string;
}

export interface MemoryBlock {
  value: string;
  limit: number;
}

export interface SendMessageOptions {
  overrideModel?: string;
  maxSteps?: number;
}

export interface AgentProvider {
  createAgent(params: CreateAgentParams): Promise<CreateAgentResult>;
  deleteAgent(agentId: string): Promise<void>;
  enableSleeptime(agentId: string): Promise<void>;
  storePassage(agentId: string, text: string): Promise<string>;
  deletePassage(agentId: string, passageId: string): Promise<void>;
  listPassages(agentId: string): Promise<Passage[]>;
  getBlock(agentId: string, label: string): Promise<MemoryBlock>;
  updateBlock(agentId: string, label: string, value: string): Promise<MemoryBlock>;
  sendMessage(agentId: string, content: string, options?: SendMessageOptions): Promise<string>;
}
```

**Step 4: Update src/shell/provider.ts to re-export**

Replace the entire contents of `src/shell/provider.ts`:

```typescript
// AgentProvider was promoted to the ports layer.
// Re-exported here for backwards compatibility with existing imports.
export type {
  AgentProvider,
  CreateAgentParams,
  CreateAgentResult,
  MemoryBlock,
  Passage,
  SendMessageOptions,
} from "../ports/agent-provider.js";
```

**Step 5: Run tests to confirm green and no regressions**

```bash
pnpm test src/ports/agent-provider.test.ts
pnpm test
```
Expected: all tests pass.

**Step 6: Commit**

```bash
git add src/ports/agent-provider.ts src/ports/agent-provider.test.ts src/shell/provider.ts
git commit -m "refactor: move AgentProvider interface to src/ports/agent-provider"
```

---

> **Wave 2 begins here. Ensure Tasks 1, 2, 3 are all committed before starting.**

---

### Task 4: Migrate doctor.ts

**Files:**
- Modify: `src/shell/doctor.ts`
- Modify: `src/shell/doctor.test.ts`

**Step 1: Write the new tests using port fakes**

Open `src/shell/doctor.test.ts`. The existing tests use `fs.mkdtemp` and real processes. Add a new `describe` block at the top of the file (before the existing ones) with port-injected tests:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FileSystemPort, WatcherHandle } from "../ports/filesystem.js";
import type { GitPort } from "../ports/git.js";
import {
  checkConfigFile,
  checkGit,
  checkRepoPaths,
  runDoctorFixes,
} from "./doctor.js";

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
      if (store.has(p)) return { size: store.get(p)!.length, isDirectory: () => false };
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    access: async (p) => {
      if (!store.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    rename: async (from, to) => {
      const v = store.get(from);
      if (!v) throw new Error("ENOENT");
      store.delete(from);
      store.set(to, v);
    },
    copyFile: async (src, dest) => {
      const v = store.get(src);
      if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      store.set(dest, v);
    },
    glob: async () => [],
    watch: () => ({ close: vi.fn(), on: vi.fn().mockReturnThis() } as unknown as WatcherHandle),
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

  it("returns fail when git is not found", () => {
    const fakeGit = makeFakeGit({ version: () => { throw new Error("not found"); } });
    const result = checkGit(fakeGit);
    expect(result.status).toBe("fail");
    expect(result.message).toContain("not found");
  });
});

describe("runDoctorFixes (port-injected)", () => {
  it("creates .env when missing", async () => {
    const fakeFs = makeFakeFs({});
    const fakeGit = makeFakeGit();
    const result = await runDoctorFixes("/project/config.yaml", "/project", fakeFs, fakeGit);
    expect(result.applied.some((s) => s.includes(".env"))).toBe(true);
    expect(fakeFs.store.get("/project/.env")).toContain("LETTA_API_KEY");
  });

  it("does not overwrite existing .env", async () => {
    const fakeFs = makeFakeFs({ "/project/.env": "LETTA_API_KEY=real-key\n" });
    const fakeGit = makeFakeGit();
    const result = await runDoctorFixes("/project/config.yaml", "/project", fakeFs, fakeGit);
    expect(fakeFs.store.get("/project/.env")).toBe("LETTA_API_KEY=real-key\n");
    expect(result.applied.every((s) => !s.includes(".env"))).toBe(true);
  });

  it("copies config.example.yaml when config missing and example exists", async () => {
    const fakeFs = makeFakeFs({ "/project/config.example.yaml": "repos: {}" });
    const fakeGit = makeFakeGit();
    await runDoctorFixes("/project/config.yaml", "/project", fakeFs, fakeGit);
    expect(fakeFs.store.has("/project/config.yaml")).toBe(true);
  });

  it("adds suggestion when config and example both missing", async () => {
    const fakeFs = makeFakeFs({});
    const fakeGit = makeFakeGit();
    const result = await runDoctorFixes("/project/config.yaml", "/project", fakeFs, fakeGit);
    expect(result.suggestions.some((s) => s.includes("repo-expert init"))).toBe(true);
  });
});
```

**Step 2: Run and confirm red**

```bash
pnpm test src/shell/doctor.test.ts
```
Expected: type errors / argument count mismatches (the functions don't accept port parameters yet).

**Step 3: Update doctor.ts**

Replace the imports at the top and update each function signature. Here is the complete updated `src/shell/doctor.ts`:

```typescript
import * as path from "node:path";
import type { CheckResult } from "../core/doctor.js";
import { createEmptyState } from "../core/state.js";
import { saveState } from "./state-store.js";
import type { AgentProvider } from "./provider.js";
import type { FileSystemPort } from "../ports/filesystem.js";
import type { GitPort } from "../ports/git.js";
import { nodeFileSystem } from "./adapters/node-filesystem.js";
import { nodeGit } from "./adapters/node-git.js";

export async function checkApiKey(): Promise<CheckResult> {
  if (!process.env.LETTA_API_KEY) {
    return { name: "API key", status: "fail", message: "LETTA_API_KEY not set. Add it to .env or your environment." };
  }
  return { name: "API key", status: "pass", message: "Set in environment" };
}

export async function checkApiConnection(provider: AgentProvider, agentId: string): Promise<CheckResult> {
  try {
    await provider.listPassages(agentId);
    return { name: "API connection", status: "pass", message: "Connected to Letta Cloud" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { name: "API connection", status: "fail", message: `Cannot reach Letta API: ${msg}` };
  }
}

export async function checkConfigFile(configPath: string, fs: FileSystemPort = nodeFileSystem): Promise<CheckResult> {
  try {
    await fs.access(configPath);
    return { name: "Config file", status: "pass", message: `${configPath} found` };
  } catch {
    return { name: "Config file", status: "fail", message: `${configPath} not found. Run "repo-expert init" to create it.` };
  }
}

export async function checkRepoPaths(configPath: string, fs: FileSystemPort = nodeFileSystem): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  let config: Record<string, unknown>;
  try {
    const { loadConfig } = await import("./config-loader.js");
    config = await loadConfig(configPath) as unknown as Record<string, unknown>;
  } catch {
    return [{ name: "Repo paths", status: "warn", message: "Could not parse config to check repo paths" }];
  }

  const repos = (config as { repos?: Record<string, { path: string }> }).repos ?? {};
  for (const [name, repo] of Object.entries(repos)) {
    try {
      const stat = await fs.stat(repo.path);
      if (stat.isDirectory()) {
        results.push({ name: `Repo "${name}"`, status: "pass", message: repo.path });
      } else {
        results.push({ name: `Repo "${name}"`, status: "fail", message: `${repo.path} is not a directory` });
      }
    } catch {
      results.push({ name: `Repo "${name}"`, status: "fail", message: `${repo.path} does not exist` });
    }
  }

  return results;
}

export function checkGit(git: GitPort = nodeGit): CheckResult {
  try {
    const version = git.version();
    return { name: "Git", status: "pass", message: version };
  } catch {
    return { name: "Git", status: "fail", message: "git not found on PATH" };
  }
}

export async function checkStateConsistency(configPath: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  let configRepos: Set<string>;
  try {
    const { loadConfig } = await import("./config-loader.js");
    const config = await loadConfig(configPath);
    configRepos = new Set(Object.keys(config.repos));
  } catch {
    return [];
  }

  let stateAgents: Set<string>;
  try {
    const { loadState } = await import("./state-store.js");
    const state = await loadState(".repo-expert-state.json");
    stateAgents = new Set(Object.keys(state.agents));
  } catch {
    return [];
  }

  for (const name of stateAgents) {
    if (!configRepos.has(name)) {
      results.push({
        name: "State consistency",
        status: "warn",
        message: `Agent "${name}" in state but not in config (orphaned)`,
      });
    }
  }

  for (const name of configRepos) {
    if (!stateAgents.has(name)) {
      results.push({
        name: "State consistency",
        status: "warn",
        message: `Repo "${name}" in config but no agent created yet`,
      });
    }
  }

  if (results.length === 0 && stateAgents.size > 0) {
    results.push({ name: "State consistency", status: "pass", message: "State matches config" });
  }

  return results;
}

export async function runAllChecks(provider: AgentProvider | null, configPath: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  results.push(await checkApiKey());

  if (provider) {
    try {
      const { loadState } = await import("./state-store.js");
      const state = await loadState(".repo-expert-state.json");
      const firstAgent = Object.values(state.agents)[0];
      if (firstAgent) {
        results.push(await checkApiConnection(provider, firstAgent.agentId));
      } else {
        results.push({ name: "API connection", status: "warn", message: "No agents yet — run setup to verify connection" });
      }
    } catch {
      results.push({ name: "API connection", status: "warn", message: "No state file — run setup to verify connection" });
    }
  }

  results.push(await checkConfigFile(configPath));

  const configExists = results.some((r) => r.name === "Config file" && r.status === "pass");
  if (configExists) {
    results.push(...(await checkRepoPaths(configPath)));
    results.push(...(await checkStateConsistency(configPath)));
  }

  results.push(checkGit());

  return results;
}

export interface DoctorFixResult {
  applied: string[];
  suggestions: string[];
}

export async function runDoctorFixes(
  configPath: string,
  cwd = process.cwd(),
  fs: FileSystemPort = nodeFileSystem,
  _git: GitPort = nodeGit,
): Promise<DoctorFixResult> {
  const applied: string[] = [];
  const suggestions: string[] = [];

  const envPath = path.resolve(cwd, ".env");
  try {
    await fs.access(envPath);
  } catch {
    await fs.writeFile(envPath, "LETTA_API_KEY=your-key-here\n");
    applied.push(`Created ${envPath} with LETTA_API_KEY template.`);
  }

  try {
    await fs.access(configPath);
  } catch {
    const examplePath = path.resolve(cwd, "config.example.yaml");
    try {
      await fs.copyFile(examplePath, configPath);
      applied.push(`Copied ${examplePath} to ${configPath}.`);
    } catch {
      suggestions.push(`Create ${configPath} manually or run "repo-expert init".`);
    }
  }

  const statePath = path.resolve(cwd, ".repo-expert-state.json");
  try {
    await fs.access(statePath);
  } catch {
    await saveState(statePath, createEmptyState(), fs);
    applied.push(`Created empty state file at ${statePath}.`);
  }

  if (applied.length === 0) {
    suggestions.push("No automatic fixes were needed.");
  }

  return { applied, suggestions };
}
```

Note: `saveState` already accepts an optional `FileSystemPort` — verify its signature in `src/shell/state-store.ts` and pass `fs` through.

**Step 4: Run and confirm green**

```bash
pnpm test src/shell/doctor.test.ts
```
Expected: all tests pass.

**Step 5: Full suite check**

```bash
pnpm test
```
Expected: all tests pass.

**Step 6: Commit**

```bash
git add src/shell/doctor.ts src/shell/doctor.test.ts
git commit -m "feat: inject FileSystemPort and GitPort into doctor.ts"
```

---

### Task 5: Migrate init.ts

**Files:**
- Modify: `src/shell/init.ts`
- Modify: `src/shell/init.test.ts`

**Step 1: Add port-injected tests**

Open `src/shell/init.test.ts`. Add a new `describe` block with port-injected tests. Add these imports at the top (or alongside existing imports):

```typescript
import type { FileSystemPort, WatcherHandle } from "../ports/filesystem.js";
import { vi } from "vitest";
```

Add this describe block:

```typescript
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
      if (!v) throw new Error("ENOENT");
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
  it("writes .env when API key provided via flag", async () => {
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
    const fakeFs = makeFakeFs({ "/repo": "not-a-dir" }); // not "__DIR__"
    const rl = { question: vi.fn().mockResolvedValue("") } as unknown as import("node:readline/promises").Interface;

    await expect(
      runInit(rl, { repoPath: "/repo", assumeYes: true, allowPrompts: false, cwd: "/project", fs: fakeFs }),
    ).rejects.toThrow();
  });
});
```

**Step 2: Run and confirm red**

```bash
pnpm test src/shell/init.test.ts
```
Expected: type errors — `RunInitOptions` doesn't have `cwd` or `fs` yet.

**Step 3: Update init.ts**

Modify the imports and `RunInitOptions`:

```typescript
import * as os from "node:os";
import * as path from "node:path";
import type * as readline from "node:readline/promises";
import type { FileSystemPort } from "../ports/filesystem.js";
import { nodeFileSystem } from "./adapters/node-filesystem.js";
import {
  detectExtensions,
  suggestIgnoreDirs,
  detectRepoName,
  generateConfigYaml,
} from "../core/init.js";

export interface RunInitOptions {
  apiKey?: string;
  repoPath?: string;
  assumeYes?: boolean;
  allowPrompts?: boolean;
  cwd?: string;
  fs?: FileSystemPort;
}
```

Update `scanFilePaths` to accept `fs`:

```typescript
async function scanFilePaths(repoPath: string, fs: FileSystemPort): Promise<string[]> {
  return fs.glob(["**/*"], {
    cwd: repoPath,
    absolute: false,
    dot: true,
    deep: 3,
    onlyFiles: true,
    followSymbolicLinks: false,
  });
}
```

Update `runInit` signature and body — replace `path.resolve(...)` calls with `path.resolve(cwd, ...)`:

```typescript
export async function runInit(rl: readline.Interface, options: RunInitOptions = {}): Promise<InitResult> {
  const {
    apiKey: apiKeyFromFlag,
    repoPath: repoPathFromFlag,
    assumeYes = false,
    allowPrompts = true,
    cwd = process.cwd(),
    fs = nodeFileSystem,
  } = options;
  console.log("repo-expert init — set up your first agent\n");

  const envPath = path.resolve(cwd, ".env");
  // ... rest of function replacing all `fs.*` with `await fs.*` (same as before)
  // and replacing `fast-glob` calls with `scanFilePaths(resolvedPath, fs)`
  // and replacing path.resolve(".env") with path.resolve(cwd, ".env")
  // and replacing path.resolve("config.yaml") with path.resolve(cwd, "config.yaml")
```

Key replacements:
- `await fs.readFile(envPath, "utf8")` (was `import * as fs from "node:fs/promises"` then `fs.readFile`)
- `await fs.writeFile(envPath, ...)`
- `await fs.stat(resolvedPath)`
- `await fs.access(path.join(resolvedPath, ".git"))`
- `const files = await scanFilePaths(resolvedPath, fs)`
- `await fs.readFile(path.join(resolvedPath, "package.json"), "utf8")`
- `await fs.writeFile(configPath, yamlContent)`
- Remove `import fg from "fast-glob"` and `import * as fs from "node:fs/promises"` from the top

**Step 4: Run and confirm green**

```bash
pnpm test src/shell/init.test.ts
```
Expected: all tests pass.

**Step 5: Full suite check**

```bash
pnpm test
```

**Step 6: Commit**

```bash
git add src/shell/init.ts src/shell/init.test.ts
git commit -m "feat: inject FileSystemPort into init.ts; accept cwd param"
```

---

### Task 6: Migrate self-check.ts

**Files:**
- Modify: `src/shell/self-check.ts`
- Modify: `src/shell/self-check.test.ts`

**Step 1: Add port-injected tests**

Open `src/shell/self-check.test.ts`. Add a new describe block with fake ports:

```typescript
import type { FileSystemPort, WatcherHandle } from "../ports/filesystem.js";
import { vi } from "vitest";

function makeFakeFs(files: Record<string, string> = {}): FileSystemPort {
  const store = new Map(Object.entries(files));
  return {
    readFile: async (p) => {
      const v = store.get(p);
      if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return v;
    },
    writeFile: async (p, d) => { store.set(p, d); },
    stat: async (p) => {
      if (store.has(p)) return { size: 0, isDirectory: () => false };
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    access: async (p) => {
      if (!store.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    rename: async () => {},
    copyFile: async () => {},
    glob: async () => [],
    watch: () => ({ close: vi.fn(), on: vi.fn().mockReturnThis() } as unknown as WatcherHandle),
  };
}

describe("runSelfChecks (port-injected)", () => {
  it("reports pnpm pass when runCommand returns a version", async () => {
    const fakeFs = makeFakeFs({
      "/project/package.json": JSON.stringify({ packageManager: "pnpm@8.0.0", dependencies: {} }),
      "/project/node_modules": "",
    });
    const fakeRunCommand = vi.fn().mockReturnValue("8.0.0");

    const results = await runSelfChecks("/project", 18, fakeFs, fakeRunCommand);
    const pnpm = results.find((r) => r.name === "pnpm");
    expect(pnpm?.status).toBe("pass");
    expect(fakeRunCommand).toHaveBeenCalledWith("pnpm", ["--version"], "/project");
  });

  it("reports pnpm fail when runCommand throws", async () => {
    const fakeFs = makeFakeFs({
      "/project/package.json": JSON.stringify({ packageManager: "pnpm@8.0.0" }),
    });
    const fakeRunCommand = vi.fn().mockImplementation(() => { throw new Error("not found"); });

    const results = await runSelfChecks("/project", 18, fakeFs, fakeRunCommand);
    const pnpm = results.find((r) => r.name === "pnpm");
    expect(pnpm?.status).toBe("fail");
  });

  it("reports dependencies fail when node_modules missing", async () => {
    const fakeFs = makeFakeFs({
      "/project/package.json": JSON.stringify({ packageManager: "pnpm@8.0.0", dependencies: { vitest: "^1.0.0" } }),
    });
    const fakeRunCommand = vi.fn().mockReturnValue("8.0.0");

    const results = await runSelfChecks("/project", 18, fakeFs, fakeRunCommand);
    const deps = results.find((r) => r.name === "dependencies");
    expect(deps?.status).toBe("fail");
    expect(deps?.message).toContain("node_modules");
  });

  it("reports no package.json when missing", async () => {
    const fakeFs = makeFakeFs({});
    const fakeRunCommand = vi.fn().mockReturnValue("8.0.0");

    const results = await runSelfChecks("/project", 18, fakeFs, fakeRunCommand);
    const pkg = results.find((r) => r.name === "package.json");
    expect(pkg?.status).toBe("warn");
  });
});
```

**Step 2: Run and confirm red**

```bash
pnpm test src/shell/self-check.test.ts
```
Expected: argument count mismatch errors.

**Step 3: Update self-check.ts**

Replace the top-level imports and update `runSelfChecks`:

```typescript
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { FileSystemPort } from "../ports/filesystem.js";
import { nodeFileSystem } from "./adapters/node-filesystem.js";
```

Remove `import * as fs from "node:fs/promises"`.

Change the private `runCommand` function to a local constant (not exported, used as default):

```typescript
function defaultRunCommand(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
```

Update `readPackageJson` to accept `fs`:
```typescript
async function readPackageJson(cwd: string, fs: FileSystemPort): Promise<PackageJsonShape | null> {
  const packagePath = path.join(cwd, "package.json");
  try {
    const raw = await fs.readFile(packagePath, "utf8");
    return JSON.parse(raw) as PackageJsonShape;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
```

Update `checkPnpm` to accept `runCommand`:
```typescript
async function checkPnpm(
  cwd: string,
  runCommand: (cmd: string, args: string[], cwd: string) => string,
): Promise<SelfCheckResult> {
  try {
    const version = runCommand("pnpm", ["--version"], cwd);
    return { name: "pnpm", status: "pass", message: `Found ${version}` };
  } catch {
    return { name: "pnpm", status: "fail", message: "pnpm not found on PATH" };
  }
}
```

Update `checkDependencies` to accept `fs`:
```typescript
async function checkDependencies(cwd: string, pkg: PackageJsonShape | null, fs: FileSystemPort): Promise<SelfCheckResult> {
  // ... same body but use fs.access() instead of the old import
```

Update `runSelfChecks` signature:
```typescript
export async function runSelfChecks(
  cwd = process.cwd(),
  minNodeMajor = 18,
  fs: FileSystemPort = nodeFileSystem,
  runCommand: (cmd: string, args: string[], cwd: string) => string = defaultRunCommand,
): Promise<SelfCheckResult[]> {
  const packageJson = await readPackageJson(cwd, fs);
  const results: SelfCheckResult[] = [];
  results.push(await checkNodeVersion(minNodeMajor));
  results.push(await checkPnpm(cwd, runCommand));
  results.push(checkPackageManagerDeclaration(packageJson));
  results.push(await checkDependencies(cwd, packageJson, fs));
  return results;
}
```

**Step 4: Run and confirm green**

```bash
pnpm test src/shell/self-check.test.ts
```

**Step 5: Full suite**

```bash
pnpm test
```

**Step 6: Commit**

```bash
git add src/shell/self-check.ts src/shell/self-check.test.ts
git commit -m "feat: inject FileSystemPort and runCommand into self-check.ts"
```

---

### Task 7: Migrate watch.ts

**Files:**
- Modify: `src/shell/watch.ts`
- Modify: `src/shell/watch.test.ts`

**Step 1: Add port-injected tests**

Open `src/shell/watch.test.ts`. Locate the existing `makeMockProvider` import. Add a `makeFakeFs` and `makeFakeGit` helper:

```typescript
import type { FileSystemPort, WatcherHandle } from "../ports/filesystem.js";
import type { GitPort } from "../ports/git.js";

function makeFakeFs(overrides: Partial<FileSystemPort> = {}): FileSystemPort {
  return {
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 0, isDirectory: () => false }),
    access: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    glob: vi.fn().mockResolvedValue([]),
    watch: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    } as unknown as WatcherHandle),
    ...overrides,
  };
}

function makeFakeGit(overrides: Partial<GitPort> = {}): GitPort {
  return {
    submoduleStatus: vi.fn().mockReturnValue(""),
    version: vi.fn().mockReturnValue("git version 2.39.0"),
    headCommit: vi.fn().mockReturnValue("abc1234"),
    diffFiles: vi.fn().mockReturnValue([]),
    ...overrides,
  };
}
```

Then update existing tests that mock `child_process` to instead pass `fakeGit` to `watchRepos`, and update tests that mock `node:fs` `watch` to pass `fakeFs`. For example, the test that checks `gitHeadCommit` behavior:

```typescript
it("aborts without sync when HEAD commit returns null", async () => {
  const fakeGit = makeFakeGit({ headCommit: vi.fn().mockReturnValue(null) });
  const fakeFs = makeFakeFs();
  // ... set up state mock ...
  await watchRepos({
    provider: makeMockProvider(),
    config: testConfig,
    repoNames: ["myrepo"],
    statePath: ".state.json",
    intervalMs: 100,
    signal: AbortSignal.abort(),
    git: fakeGit,
    fs: fakeFs,
  });
  expect(fakeGit.headCommit).toHaveBeenCalled();
});
```

**Step 2: Run and confirm red**

```bash
pnpm test src/shell/watch.test.ts
```
Expected: `WatchParams` doesn't have `git` or `fs` yet.

**Step 3: Update watch.ts**

Add imports at the top, remove direct node module imports:

```typescript
import * as path from "node:path";
import type { FSWatcher } from "node:fs";
import { loadState, saveState } from "./state-store.js";
import { collectFiles } from "./file-collector.js";
import { syncRepo } from "./sync.js";
import { shouldSync, formatSyncLog, computeBackoffDelay } from "../core/watch.js";
import { updateAgentField } from "../core/state.js";
import { shouldIncludeFile } from "../core/filter.js";
import { partitionDiffPaths } from "../core/submodule.js";
import { listSubmodules, expandSubmoduleFiles } from "./submodule-collector.js";
import type { AgentProvider } from "./provider.js";
import type { AgentState, Config, FileInfo, RepoConfig } from "../core/types.js";
import type { FileSystemPort, WatcherHandle } from "../ports/filesystem.js";
import type { GitPort } from "../ports/git.js";
import { nodeFileSystem } from "./adapters/node-filesystem.js";
import { nodeGit } from "./adapters/node-git.js";
```

Extend `WatchParams`:
```typescript
export interface WatchParams {
  provider: AgentProvider;
  config: Config;
  repoNames: string[];
  statePath: string;
  intervalMs: number;
  debounceMs?: number;
  signal: AbortSignal;
  log?: (msg: string) => void;
  fs?: FileSystemPort;
  git?: GitPort;
}
```

Remove the private `gitHeadCommit` and `gitDiffFiles` functions (replaced by port).

Update `collectFile` to accept `fs`:
```typescript
async function collectFile(repoPath: string, filePath: string, fs: FileSystemPort): Promise<FileInfo | null> {
  const absPath = path.join(repoPath, filePath);
  try {
    const content = await fs.readFile(absPath, "utf8");
    const stat = await fs.stat(absPath);
    return { path: filePath, content, sizeKb: stat.size / 1024 };
  } catch {
    return null;
  }
}
```

Update `watchRepos` to destructure `fs` and `git`:
```typescript
export async function watchRepos(params: WatchParams): Promise<void> {
  const {
    // ...existing params...
    fs = nodeFileSystem,
    git = nodeGit,
  } = params;

  // Replace watchers: FSWatcher[] with watchers: WatcherHandle[]
  const watchers: WatcherHandle[] = [];

  // Replace gitHeadCommit(repoConfig.path) with:
  const currentHead = git.headCommit(repoConfig.path);

  // Replace gitDiffFiles(repoConfig.path, ...) with:
  const diffResult = git.diffFiles(repoConfig.path, agentInfo.lastSyncCommit);

  // Replace fsWatch(...) with:
  const watcher = fs.watch(repoConfig.path, { recursive: true }, (_event, fileName) => { ... });

  // Pass fs through to collectFile:
  collectFile(repoPath, filePath, fs)
```

**Step 4: Run and confirm green**

```bash
pnpm test src/shell/watch.test.ts
```

**Step 5: Full suite**

```bash
pnpm test
```
Expected: all tests pass.

**Step 6: Commit**

```bash
git add src/shell/watch.ts src/shell/watch.test.ts
git commit -m "feat: inject FileSystemPort and GitPort into watch.ts"
```

---

> **Wave 3 begins here. Ensure Tasks 4, 5, 6, 7 are all committed before starting.**

---

### Task 8: Raise shell Stryker mutation threshold

**Files:**
- Modify: `stryker.shell.config.mjs`

**Step 1: Remove exclusions and raise threshold**

Replace the contents of `stryker.shell.config.mjs`:

```javascript
export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.stryker.shell.config.ts" },
  mutate: [
    "src/shell/**/*.ts",
    "!src/shell/**/*.test.ts",
  ],
  coverageAnalysis: "perTest",
  thresholds: { high: 97, low: 90, break: 70 },
  reporters: ["clear-text", "progress"],
};
```

**Step 2: Run Stryker for shell**

```bash
pnpm exec stryker run stryker.shell.config.mjs
```

Expected: mutation score ≥ 70%. If it fails (score < 70%), the output will list surviving mutants — add targeted tests to kill each one, then re-run until the threshold passes.

**Step 3: Run full test suite one final time**

```bash
pnpm test
```
Expected: all tests pass.

**Step 4: Commit**

```bash
git add stryker.shell.config.mjs
git commit -m "feat: raise shell Stryker mutation threshold to 70%"
```

---

## Completion Checklist

- [ ] Task 1: GitPort + nodeGit expanded (3 new methods)
- [ ] Task 2: FileSystemPort + nodeFileSystem expanded (watch + GlobOptions)
- [ ] Task 3: AgentProvider moved to `src/ports/agent-provider.ts`
- [ ] Task 4: doctor.ts accepts FileSystemPort + GitPort
- [ ] Task 5: init.ts accepts FileSystemPort + cwd
- [ ] Task 6: self-check.ts accepts FileSystemPort + runCommand
- [ ] Task 7: watch.ts accepts FileSystemPort + GitPort
- [ ] Task 8: Shell Stryker threshold ≥ 70%
- [ ] `pnpm test` green throughout
