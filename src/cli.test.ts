import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { afterEach, describe, expect, it } from "vitest";

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function tsxBinPath(): string {
  const bin = process.platform === "win32" ? "tsx.cmd" : "tsx";
  return path.resolve("node_modules", ".bin", bin);
}

const cliEntryPath = path.resolve("src/cli.ts");

function runCli(args: string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}): CliResult {
  const result = spawnSync(tsxBinPath(), [cliEntryPath, ...args], {
    cwd,
    env: { ...process.env, ...extraEnv },
    encoding: "utf-8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

const tempDirs: string[] = [];

async function makeWorkspace(prefix: string): Promise<string> {
  const dir = await makeTempDir(prefix);
  tempDirs.push(dir);
  return dir;
}

async function writeConfig(cwd: string, repoName: string, repoPath: string): Promise<void> {
  const config = [
    "letta:",
    "  model: openai/gpt-4.1",
    "  embedding: openai/text-embedding-3-small",
    "repos:",
    `  ${repoName}:`,
    `    path: ${repoPath}`,
    "    description: test repo",
    "    extensions: [.ts]",
    "    ignore_dirs: [node_modules, .git]",
    "    bootstrap_on_create: false",
  ].join("\n");
  await fs.writeFile(path.join(cwd, "config.yaml"), config, "utf-8");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("cli contract", () => {
  it("supports list --json for script-friendly output", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-list-");
    const state = {
      agents: {
        "my-app": {
          agentId: "agent-1",
          repoName: "my-app",
          passages: { "src/a.ts": ["p-1"] },
          lastBootstrap: null,
          lastSyncCommit: null,
          lastSyncAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };
    await fs.writeFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf-8");

    const result = runCli(["list", "--json"], cwd);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const data = JSON.parse(result.stdout);
    expect(data).toEqual([
      {
        repoName: "my-app",
        agentId: "agent-1",
        files: 1,
        passages: 1,
        bootstrapped: false,
      },
    ]);
  });

  it("fails fast with --no-input for destructive commands unless --force is provided", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-no-input-");
    const state = {
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
    await fs.writeFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf-8");

    const result = runCli(["--no-input", "destroy", "--repo", "my-app"], cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--force");
    expect(result.stderr).toContain("--no-input");
  });

  it("supports mcp-install --local and writes config in current directory", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-local-");
    const home = await makeWorkspace("repo-expert-cli-home-");

    const result = runCli(["mcp-install", "--local"], cwd, {
      HOME: home,
      LETTA_API_KEY: "test-key",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const localConfigPath = path.join(cwd, ".claude.json");
    const homeConfigPath = path.join(home, ".claude.json");
    const localRaw = await fs.readFile(localConfigPath, "utf-8");
    const localConfig = JSON.parse(localRaw) as { mcpServers?: { letta?: unknown } };

    await expect(fs.access(homeConfigPath)).rejects.toThrow();
    expect(localConfig.mcpServers?.letta).toBeDefined();
  });

  it("shows actionable error without stack trace when mcp-check config is malformed", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-malformed-");
    const home = await makeWorkspace("repo-expert-cli-home-malformed-");
    await fs.writeFile(path.join(home, ".claude.json"), "{ invalid json", "utf-8");

    const result = runCli(["mcp-check"], cwd, { HOME: home });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Failed to parse");
    expect(result.stderr).toContain(".claude.json");
    expect(result.stderr).not.toContain("SyntaxError:");
    expect(result.stderr).not.toContain("at Command.");
  });

  it("shows actionable error when state file is malformed", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-state-malformed-");
    await fs.writeFile(path.join(cwd, ".repo-expert-state.json"), "{ invalid json", "utf-8");

    const result = runCli(["list"], cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid state file");
    expect(result.stderr).toContain(".repo-expert-state.json");
    expect(result.stderr).toContain("remove or fix it");
    expect(result.stderr).not.toContain("Unexpected error");
  });

  it("supports non-interactive init with flags", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-init-flags-");
    const repoDir = path.join(cwd, "repo");
    await fs.mkdir(path.join(repoDir, ".git"), { recursive: true });
    await fs.writeFile(path.join(repoDir, "index.ts"), "export const ok = true;\n", "utf-8");

    const result = runCli(
      ["--no-input", "init", "--api-key", "test-key", "--repo-path", repoDir, "--yes"],
      cwd,
      { LETTA_API_KEY: "" },
    );

    expect(result.status).toBe(0);
    await expect(fs.access(path.join(cwd, ".env"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(cwd, "config.yaml"))).resolves.toBeUndefined();
  });

  it("supports destroy --dry-run", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-destroy-dry-run-");
    const state = {
      stateVersion: 2,
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
    await fs.writeFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf-8");

    const result = runCli(["destroy", "--dry-run", "--repo", "my-app"], cwd);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Dry-run: would delete 1 agent");
  });

  it("supports sync --dry-run --json", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-sync-dry-run-");
    const repoDir = path.join(cwd, "repo");
    await fs.mkdir(repoDir, { recursive: true });
    await fs.writeFile(path.join(repoDir, "a.ts"), "export const a = 1;\n", "utf-8");
    await writeConfig(cwd, "my-app", repoDir);
    const state = {
      stateVersion: 2,
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
    await fs.writeFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf-8");

    const result = runCli(["sync", "--config", "config.yaml", "--full", "--dry-run", "--json"], cwd);
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as { results: Array<{ dryRun?: boolean; changedFiles?: number }> };
    expect(payload.results[0].dryRun).toBe(true);
    expect(payload.results[0].changedFiles).toBe(1);
  });

  it("supports status --json", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-status-json-");
    const state = {
      stateVersion: 2,
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
    await fs.writeFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf-8");

    const result = runCli(["status", "--json"], cwd, {
      REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
    });

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as Array<{ repoName: string }>;
    expect(payload[0].repoName).toBe("my-app");
  });

  it("supports doctor --fix", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-doctor-fix-");
    await fs.writeFile(path.join(cwd, "config.example.yaml"), "letta:\n  model: m\n  embedding: e\nrepos: {}\n", "utf-8");

    const result = runCli(["doctor", "--fix", "--json"], cwd, {
      LETTA_API_KEY: "test-key",
      REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
    });
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as { fixes: { applied: string[] } };
    expect(payload.fixes.applied.length).toBeGreaterThan(0);
    await expect(fs.access(path.join(cwd, ".env"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(cwd, "config.yaml"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(cwd, ".repo-expert-state.json"))).resolves.toBeUndefined();
  });

  it("supports setup --reindex and emits JSON timings", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-setup-reindex-");
    const repoDir = path.join(cwd, "repo");
    await fs.mkdir(repoDir, { recursive: true });
    await fs.writeFile(path.join(repoDir, "a.ts"), "export const a = 1;\n", "utf-8");
    await writeConfig(cwd, "my-app", repoDir);
    const state = {
      stateVersion: 2,
      agents: {
        "my-app": {
          agentId: "agent-1",
          repoName: "my-app",
          passages: { "a.ts": ["p-1"] },
          lastBootstrap: null,
          lastSyncCommit: "abc123",
          lastSyncAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };
    await fs.writeFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf-8");

    const result = runCli(
      ["setup", "--config", "config.yaml", "--reindex", "--json"],
      cwd,
      { REPO_EXPERT_TEST_FAKE_PROVIDER: "1" },
    );
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as { results: Array<{ mode: string; indexMs: number; totalMs: number }> };
    expect(payload.results[0].mode).toBe("reindex_full");
    expect(payload.results[0].indexMs).toBeGreaterThanOrEqual(0);
    expect(payload.results[0].totalMs).toBeGreaterThanOrEqual(0);
  });

  it("recovers setup after partial failure and resumes on next run", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-setup-resume-");
    const repoDir = path.join(cwd, "repo");
    await fs.mkdir(repoDir, { recursive: true });
    await fs.writeFile(path.join(repoDir, "a.ts"), "export const a = 1;\n", "utf-8");
    await writeConfig(cwd, "my-app", repoDir);

    const first = runCli(
      ["setup", "--config", "config.yaml", "--json", "--load-retries", "0"],
      cwd,
      {
        REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
        REPO_EXPERT_TEST_FAIL_LOAD_ONCE: "1",
      },
    );
    expect(first.status).toBe(1);
    const firstPayload = JSON.parse(first.stdout) as { results: Array<{ status: string }> };
    expect(firstPayload.results[0].status).toBe("error");

    const stateRaw = await fs.readFile(path.join(cwd, ".repo-expert-state.json"), "utf-8");
    const state = JSON.parse(stateRaw) as { agents: Record<string, unknown> };
    expect(state.agents["my-app"]).toBeDefined();

    const second = runCli(
      ["setup", "--config", "config.yaml", "--resume", "--json"],
      cwd,
      { REPO_EXPERT_TEST_FAKE_PROVIDER: "1" },
    );
    expect(second.status).toBe(0);
    const secondPayload = JSON.parse(second.stdout) as { results: Array<{ status: string; mode: string }> };
    expect(secondPayload.results[0].status).toBe("ok");
    expect(secondPayload.results[0].mode).toBe("resume_full");
  });
});
