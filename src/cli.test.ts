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
});
