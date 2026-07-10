import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
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
    env: { ...process.env, COLUMNS: "160", ...extraEnv },
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function normalizeOutput(text: string): string {
  const rawLines = text.replaceAll('\r\n', "\n").trim().split("\n");
  const normalized: string[] = [];

  for (const rawLine of rawLines) {
    const collapsed = rawLine.trim().replaceAll(/\s+/g, " ");
    if (!collapsed) {
      normalized.push("");
      continue;
    }
    const isContinuation = /^\s{20,}\S/.test(rawLine);
    const previousLine = normalized.at(-1);
    if (isContinuation && normalized.length > 0 && previousLine !== "") {
      normalized[normalized.length - 1] = `${previousLine ?? ""} ${collapsed}`;
      continue;
    }
    normalized.push(collapsed);
  }

  return normalized.join("\n").trim();
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

async function writeWorkspaceFile(filePath: string, content: string, encoding: BufferEncoding = "utf8"): Promise<void> {
  // Path is constrained to test-owned temporary workspaces created in this file.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.writeFile(filePath, content, encoding);
}

async function readWorkspaceFile(filePath: string, encoding: BufferEncoding = "utf8"): Promise<string> {
  // Path is constrained to test-owned temporary workspaces created in this file.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.readFile(filePath, encoding);
}

async function mkdirWorkspaceDir(directoryPath: string, options?: Parameters<typeof fs.mkdir>[1]): Promise<void> {
  // Path is constrained to test-owned temporary workspaces created in this file.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.mkdir(directoryPath, options);
}

async function chmodWorkspaceFile(filePath: string, mode: number): Promise<void> {
  // Path is constrained to test-owned temporary workspaces created in this file.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.chmod(filePath, mode);
}

async function writeConfig(
  cwd: string,
  repoName: string,
  repoPath: string,
  opts: { consolidateOnSync?: boolean; basePath?: string } = {},
): Promise<void> {
  const config = [
    "provider:",
    "  model: qwen3-coder:30b",
    ...(opts.consolidateOnSync ? ["consolidate_on_sync: true"] : []),
    "repos:",
    `  ${repoName}:`,
    `    path: ${repoPath}`,
    ...(opts.basePath === undefined ? [] : [`    base_path: ${opts.basePath}`]),
    "    description: test repo",
    "    extensions: [.ts]",
    "    ignore_dirs: [node_modules, .git]",
  ].join("\n");
  await writeWorkspaceFile(path.join(cwd, "config.yaml"), config, "utf8");
}

function initGitRepo(repoDir: string): void {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });
}

async function commitFile(repoDir: string, name: string, contents: string, message: string): Promise<string> {
  await writeWorkspaceFile(path.join(repoDir, name), contents, "utf8");
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
  execFileSync("git", ["add", name], { cwd: repoDir });
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: repoDir });
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8" }).trim();
}

function gitHeadCommitForTest(repoDir: string): string {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8" }).trim();
}

/** Amends the last commit and prunes it so the previous checkpoint SHA becomes unreachable, simulating rebase/force-push drift. */
async function orphanLastCommit(repoDir: string, fileName: string, newContents: string): Promise<void> {
  await writeWorkspaceFile(path.join(repoDir, fileName), newContents, "utf8");
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
  execFileSync("git", ["add", fileName], { cwd: repoDir });
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
  execFileSync("git", ["commit", "--amend", "-q", "-m", "amended"], { cwd: repoDir });
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
  execFileSync("git", ["reflog", "expire", "--expire=now", "--all"], { cwd: repoDir });
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
  execFileSync("git", ["gc", "--prune=now", "-q"], { cwd: repoDir });
}

async function writeWarnDoctorWorkspace(cwd: string): Promise<string> {
  const repoDir = path.join(cwd, "repo");
  await mkdirWorkspaceDir(repoDir, { recursive: true });
  // Unreachable LLM base_url forces checkLlmEndpoint into a warning (never a failure).
  const config = [
    "provider:",
    "  model: qwen3-coder:30b",
    "  base_url: http://127.0.0.1:1",
    "repos:",
    "  my-app:",
    `    path: ${repoDir}`,
    "    description: test repo",
    "    extensions: [.ts]",
    "    ignore_dirs: [node_modules, .git]",
  ].join("\n");
  await writeWorkspaceFile(path.join(cwd, "config.yaml"), config, "utf8");
  return repoDir;
}

async function writeUnreachableSetupWorkspace(cwd: string): Promise<void> {
  const repoDir = path.join(cwd, "repo");
  await mkdirWorkspaceDir(repoDir, { recursive: true });
  const config = [
    "provider:",
    "  model: qwen3-coder:30b",
    "  base_url: http://127.0.0.1:1",
    "repos:",
    "  my-app:",
    `    path: ${repoDir}`,
    "    description: test repo",
  ].join("\n");
  await writeWorkspaceFile(path.join(cwd, "config.yaml"), config, "utf8");
}

async function writeAskWorkspace(cwd: string, providerLines: string[]): Promise<void> {
  const repoDir = path.join(cwd, "repo");
  await mkdirWorkspaceDir(repoDir, { recursive: true });
  const config = [
    "provider:",
    ...providerLines,
    "repos:",
    "  my-app:",
    `    path: ${repoDir}`,
    "    description: test repo",
    "    extensions: [.ts]",
    "    ignore_dirs: [node_modules, .git]",
  ].join("\n");
  await writeWorkspaceFile(path.join(cwd, "config.yaml"), config, "utf8");
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
  await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf8");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("cli contract", () => {
  it("keeps root help output stable", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-help-root-");
    const result = runCli(["--help"], cwd);

    expect(result.status).toBe(0);
    expect(normalizeOutput(result.stdout)).toMatchInlineSnapshot(`
      "Usage: repo-expert [options] [command]

      Persistent AI agents for git repositories

      Options:
      -V, --version output the version number
      --no-input Disable interactive prompts
      --debug Show stack traces for unexpected errors
      -h, --help display help for command

      Commands:
      init [options] Interactive setup: pick model + LLM endpoint, scan a repo, generate config.yaml
      doctor [options] Check setup: API key, config, repo paths, git, state consistency
      self-check [options] Check local runtime/toolchain health (Node, pnpm, dependencies)
      setup [options] Create agents from config.yaml
      config Configuration helpers
      ask [options] [repo] [question] Ask an agent a question
      sync [options] Sync file changes to agents
      list [options] List all agents
      status [options] Show agent memory stats and health
      consolidate [options] Consolidate architecture/conventions memory blocks via the LLM
      export [options] Export agent memory to markdown
      onboard [options] <repo> Guided codebase walkthrough for new developers
      destroy [options] Delete agents
      reconcile [options] Compare local passage state against the provider's actual state and report drift
      watch [options] Watch repos and auto-sync on repo changes
      install-daemon [options] Install launchd daemon for auto-sync on macOS
      uninstall-daemon Uninstall the launchd watch daemon
      install-instructions [options] Inject repo-expert usage instructions into a repo's CLAUDE.md/AGENTS.md
      mcp-install [options] Add the repo-expert MCP server entry to Claude Code config
      mcp-check [options] Validate existing MCP server entry in Claude Code config
      completion [options] <shell> Print shell completion script (bash, zsh, fish)
      help [command] display help for command

      Examples:
      repo-expert init
      repo-expert setup
      repo-expert ask my-app "Where is auth?"
      repo-expert list --json"
    `);
  });

  it("reports the package.json version for --version", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-version-");
    const pkgRaw = await readWorkspaceFile(path.resolve(path.dirname(cliEntryPath), "..", "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { version: string };

    const result = runCli(["--version"], cwd);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  it("keeps setup help output stable", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-help-setup-");
    const result = runCli(["setup", "--help"], cwd);

    expect(result.status).toBe(0);
    expect(normalizeOutput(result.stdout)).toMatchInlineSnapshot(`
      "Usage: repo-expert setup [options]

      Create agents from config.yaml

      Options:
      --repo <name> Set up a single repo
      --config <path> Config file path (default: "config.yaml")
      --resume Resume incomplete setup work (default behavior)
      --reindex Force full re-index for existing agents
      --no-bootstrap Skip the bootstrap analysis stage
      --json Output setup results as JSON
      --load-retries <n> Retries for passage loading (default: "2")
      --bootstrap-retries <n> Retries for bootstrap stage (default: "2")
      --load-timeout-ms <ms> Timeout for passage loading stage (default: "300000")
      --bootstrap-timeout-ms <ms> Timeout for bootstrap stage (default: "120000")
      --skip-preflight Skip the LLM endpoint/model reachability check before indexing
      -h, --help display help for command"
    `);
  });

  it("keeps unknown command errors stable", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-help-unknown-");
    const result = runCli(["no-such-command"], cwd);

    expect(result.status).toBe(1);
    expect(normalizeOutput(result.stderr)).toMatchInlineSnapshot(`
      "error: unknown command 'no-such-command'"
    `);
  });

  it("enforces non-interactive command contract matrix", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-no-input-matrix-");
    await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify({ stateVersion: 2, agents: {} }), "utf8");

    const cases = [
      {
        args: ["--no-input", "destroy"] as string[],
        expectedStatus: 0,
        expectedStdout: "No agents to destroy.",
      },
      {
        args: ["--no-input", "init"] as string[],
        expectedStatus: 1,
        expectedStderr: "Repository path is required.",
      },
    ];

    for (const testCase of cases) {
      const result = runCli(testCase.args, cwd, { LLM_API_KEY: "" });
      expect(result.status).toBe(testCase.expectedStatus);
      expect(result.stderr).toContain(testCase.expectedStderr ?? "");
      expect(result.stdout).toContain(testCase.expectedStdout ?? "");
    }
  });

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
    await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf8");

    const result = runCli(["list", "--json"], cwd);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const data = JSON.parse(result.stdout) as Array<{
      repoName: string;
      agentId: string;
      files: number;
      passages: number;
      bootstrapped: boolean;
      lastSyncAt: string | null;
    }>;
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
    await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf8");

    const result = runCli(["--no-input", "destroy", "--repo", "my-app"], cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--force");
    expect(result.stderr).toContain("--no-input");
  });

  it("supports mcp-install --local and writes config in current directory", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-local-");
    const home = await makeWorkspace("repo-expert-cli-home-");
    const repoDir = path.join(cwd, "repo");
    await mkdirWorkspaceDir(repoDir, { recursive: true });
    await writeConfig(cwd, "my-app", repoDir);

    const result = runCli(["mcp-install", "--local"], cwd, {
      HOME: home,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const localConfigPath = path.join(cwd, ".claude.json");
    const homeConfigPath = path.join(home, ".claude.json");
    const localRaw = await readWorkspaceFile(localConfigPath, "utf8");
    const localConfig = JSON.parse(localRaw) as {
      mcpServers?: { "repo-expert"?: { command?: string; args?: string[]; env?: Record<string, string> } };
    };

    await expect(fs.access(homeConfigPath)).rejects.toThrow();
    const entry = localConfig.mcpServers?.["repo-expert"];
    expect(entry).toBeDefined();
    expect(entry?.env?.LLM_MODEL).toBe("qwen3-coder:30b");
    // Dev checkout: server path is the sibling of the running cli.ts, not cwd-relative.
    expect(entry?.command).toBe("npx");
    expect(entry?.args).toEqual(["tsx", path.join(path.dirname(cliEntryPath), "mcp-server.ts")]);
  });

  it("writes LLM MCP env from environment variables when no config is present", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-local-llm-");
    const home = await makeWorkspace("repo-expert-cli-home-llm-");

    const result = runCli(["mcp-install", "--local"], cwd, {
      HOME: home,
      LLM_MODEL: "llama3.1:8b",
      LLM_API_KEY: "sk-test-key",
    });

    expect(result.status).toBe(0);
    const localRaw = await readWorkspaceFile(path.join(cwd, ".claude.json"), "utf8");
    const localConfig = JSON.parse(localRaw) as {
      mcpServers?: { "repo-expert"?: { env?: Record<string, string> } };
    };
    expect(localConfig.mcpServers?.["repo-expert"]?.env?.LLM_MODEL).toBe("llama3.1:8b");
    expect(localConfig.mcpServers?.["repo-expert"]?.env?.LLM_API_KEY).toBe("sk-test-key");
    expect(localConfig.mcpServers?.["repo-expert"]?.env?.PROVIDER_TYPE).toBeUndefined();
  });

  it("writes MCP config and warns when config.yaml is missing", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-local-mcp-warn-");
    const home = await makeWorkspace("repo-expert-cli-home-mcp-warn-");

    const result = runCli(["mcp-install", "--local"], cwd, {
      HOME: home,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Warnings:");
    expect(result.stdout).toContain("config.yaml not found");
    const localRaw = await readWorkspaceFile(path.join(cwd, ".claude.json"), "utf8");
    const localConfig = JSON.parse(localRaw) as { mcpServers?: { "repo-expert"?: unknown } };
    expect(localConfig.mcpServers?.["repo-expert"]).toBeDefined();
  });

  it("installs instructions, is idempotent, and supports --remove", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-install-instructions-");
    const repoDir = path.join(cwd, "repo");
    await mkdirWorkspaceDir(repoDir, { recursive: true });
    await writeWorkspaceFile(path.join(repoDir, "CLAUDE.md"), "# My Repo\n", "utf8");
    await writeConfig(cwd, "my-app", repoDir);

    const first = runCli(["install-instructions"], cwd);
    expect(first.status).toBe(0);
    expect(first.stderr).toBe("");
    expect(first.stdout).toContain("updated");

    const claudeMd = await readWorkspaceFile(path.join(repoDir, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("<!-- repo-expert:start -->");
    expect(claudeMd).toContain("# My Repo");
    await expect(fs.access(path.join(repoDir, "AGENTS.md"))).rejects.toThrow();

    const second = runCli(["install-instructions"], cwd);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("already up to date");
    expect(second.stdout).not.toContain("updated");

    const removed = runCli(["install-instructions", "--remove"], cwd);
    expect(removed.status).toBe(0);
    expect(removed.stdout).toContain("removed");
    const claudeMdAfterRemove = await readWorkspaceFile(path.join(repoDir, "CLAUDE.md"), "utf8");
    expect(claudeMdAfterRemove).not.toContain("<!-- repo-expert:start -->");
    expect(claudeMdAfterRemove).toContain("# My Repo");
  });

  it("shows actionable error without stack trace when mcp-check config is malformed", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-malformed-");
    const home = await makeWorkspace("repo-expert-cli-home-malformed-");
    await writeWorkspaceFile(path.join(home, ".claude.json"), "{ invalid json", "utf8");

    const result = runCli(["mcp-check"], cwd, { HOME: home });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Failed to parse");
    expect(result.stderr).toContain(".claude.json");
    expect(result.stderr).not.toContain("SyntaxError:");
    expect(result.stderr).not.toContain("at Command.");
  });

  it("shows actionable error when state file is malformed", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-state-malformed-");
    await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), "{ invalid json", "utf8");

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
    await mkdirWorkspaceDir(path.join(repoDir, ".git"), { recursive: true });
    await writeWorkspaceFile(path.join(repoDir, "index.ts"), "export const ok = true;\n", "utf8");

    const result = runCli(
      ["--no-input", "init", "--api-key", "test-key", "--repo-path", repoDir, "--yes"],
      cwd,
      { LETTA_API_KEY: "" },
    );

    expect(result.status).toBe(0);
    await expect(fs.access(path.join(cwd, ".env"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(cwd, "config.yaml"))).resolves.toBeUndefined();
  });

  it("supports --embedding-engine transformersjs on non-interactive init", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-init-embedding-engine-");
    const repoDir = path.join(cwd, "repo");
    await mkdirWorkspaceDir(path.join(repoDir, ".git"), { recursive: true });
    await writeWorkspaceFile(path.join(repoDir, "index.ts"), "export const ok = true;\n", "utf8");

    const result = runCli(
      ["--no-input", "init", "--repo-path", repoDir, "--embedding-engine", "transformersjs", "--yes"],
      cwd,
    );

    expect(result.status).toBe(0);
    const config = await readWorkspaceFile(path.join(cwd, "config.yaml"), "utf8");
    expect(config).toContain("embedding_engine: transformersjs");
  });

  it("rejects an invalid --embedding-engine value", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-init-embedding-engine-invalid-");
    const repoDir = path.join(cwd, "repo");
    await mkdirWorkspaceDir(path.join(repoDir, ".git"), { recursive: true });
    await writeWorkspaceFile(path.join(repoDir, "index.ts"), "export const ok = true;\n", "utf8");

    const result = runCli(
      ["--no-input", "init", "--repo-path", repoDir, "--embedding-engine", "webgpu", "--yes"],
      cwd,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid --embedding-engine");
    await expect(fs.access(path.join(cwd, "config.yaml"))).rejects.toThrow();
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
    await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf8");

    const result = runCli(["destroy", "--dry-run", "--repo", "my-app"], cwd);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Dry-run: would delete 1 agent");
  });

  it("supports sync --dry-run --json", { timeout: 30_000 }, async () => {
    const cwd = await makeWorkspace("repo-expert-cli-sync-dry-run-");
    const repoDir = path.join(cwd, "repo");
    await mkdirWorkspaceDir(repoDir, { recursive: true });
    await writeWorkspaceFile(path.join(repoDir, "a.ts"), "export const a = 1;\n", "utf8");
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
    await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf8");

    const result = runCli(["sync", "--config", "config.yaml", "--full", "--dry-run", "--json"], cwd);
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as { results: Array<{ dryRun?: boolean; changedFiles?: number }> };
    expect(payload.results[0].dryRun).toBe(true);
    expect(payload.results[0].changedFiles).toBe(1);
  });

  it("performs a normal incremental sync against a valid checkpoint commit", { timeout: 30_000 }, async () => {
    const cwd = await makeWorkspace("repo-expert-cli-sync-checkpoint-valid-");
    const repoDir = path.join(cwd, "repo");
    await mkdirWorkspaceDir(repoDir, { recursive: true });
    initGitRepo(repoDir);
    const checkpointSha = await commitFile(repoDir, "a.ts", "export const a = 1;\n", "add a.ts");
    await commitFile(repoDir, "b.ts", "export const b = 2;\n", "add b.ts");
    const headSha = gitHeadCommitForTest(repoDir);
    await writeConfig(cwd, "my-app", repoDir);

    const state = {
      stateVersion: 2,
      agents: {
        "my-app": {
          agentId: "agent-1",
          repoName: "my-app",
          passages: {},
          lastBootstrap: null,
          lastSyncCommit: checkpointSha,
          lastSyncAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };
    await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf8");

    const result = runCli(["sync", "--config", "config.yaml"], cwd, { REPO_EXPERT_TEST_FAKE_PROVIDER: "1" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 changed files since");
    expect(result.stderr).toBe("");

    const savedState = JSON.parse(await readWorkspaceFile(path.join(cwd, ".repo-expert-state.json"))) as {
      agents: Record<string, { lastSyncCommit: string }>;
    };
    expect(savedState.agents["my-app"].lastSyncCommit).toBe(headSha);
  });

  it("scopes incremental sync paths to a configured monorepo base_path", { timeout: 30_000 }, async () => {
    const cwd = await makeWorkspace("repo-expert-cli-sync-base-path-");
    const repoDir = path.join(cwd, "repo");
    await mkdirWorkspaceDir(path.join(repoDir, "packages", "app"), { recursive: true });
    await mkdirWorkspaceDir(path.join(repoDir, "packages", "other"), { recursive: true });
    initGitRepo(repoDir);
    await writeWorkspaceFile(path.join(repoDir, "packages", "app", "a.ts"), "export const a = 1;\n");
    await writeWorkspaceFile(path.join(repoDir, "packages", "other", "a.ts"), "export const other = 1;\n");
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: repoDir });
    const checkpointSha = gitHeadCommitForTest(repoDir);
    await commitFile(repoDir, "packages/app/b.ts", "export const b = 2;\n", "add app b");
    await commitFile(repoDir, "packages/other/b.ts", "export const otherB = 2;\n", "add other b");
    await writeConfig(cwd, "my-app", repoDir, { basePath: "packages/app" });

    const state = {
      stateVersion: 2,
      agents: {
        "my-app": {
          agentId: "agent-1",
          repoName: "my-app",
          passages: {},
          fileHashes: {},
          lastBootstrap: null,
          lastSyncCommit: checkpointSha,
          lastSyncAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };
    await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state));

    const result = runCli(["sync", "--config", "config.yaml"], cwd, {
      REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 changed files since");
    const savedState = JSON.parse(await readWorkspaceFile(path.join(cwd, ".repo-expert-state.json"))) as {
      agents: Record<string, { fileHashes?: Record<string, string> }>;
    };
    expect(savedState.agents["my-app"].fileHashes).toHaveProperty("b.ts");
    expect(savedState.agents["my-app"].fileHashes).not.toHaveProperty("packages/other/b.ts");
  });

  it("fails fast when the checkpoint commit is orphaned, even if a last-sync timestamp is available", { timeout: 30_000 }, async () => {
    const cwd = await makeWorkspace("repo-expert-cli-sync-checkpoint-since-");
    const repoDir = path.join(cwd, "repo");
    await mkdirWorkspaceDir(repoDir, { recursive: true });
    initGitRepo(repoDir);
    const orphanedSha = await commitFile(repoDir, "a.ts", "export const a = 1;\n", "add a.ts");
    await orphanLastCommit(repoDir, "a.ts", "export const a = 2;\n");
    const headSha = gitHeadCommitForTest(repoDir);
    expect(headSha).not.toBe(orphanedSha);
    await writeConfig(cwd, "my-app", repoDir);

    const state = {
      stateVersion: 2,
      agents: {
        "my-app": {
          agentId: "agent-1",
          repoName: "my-app",
          passages: {},
          lastBootstrap: null,
          lastSyncCommit: orphanedSha,
          lastSyncAt: "2000-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };
    await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf8");

    const result = runCli(["sync", "--config", "config.yaml"], cwd, { REPO_EXPERT_TEST_FAKE_PROVIDER: "1" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`checkpoint commit ${orphanedSha.slice(0, 7)} no longer exists`);
    expect(result.stderr).toContain("Refusing to guess a diff window");
    expect(result.stdout).not.toContain("changed files since");

    // The stored checkpoint is authoritative: state must be left untouched.
    const savedState = JSON.parse(await readWorkspaceFile(path.join(cwd, ".repo-expert-state.json"))) as {
      agents: Record<string, { lastSyncCommit: string }>;
    };
    expect(savedState.agents["my-app"].lastSyncCommit).toBe(orphanedSha);
    expect(headSha).not.toBe(orphanedSha);
  });

  it("fails fast when the checkpoint commit is orphaned and no last-sync timestamp is available", { timeout: 30_000 }, async () => {
    const cwd = await makeWorkspace("repo-expert-cli-sync-checkpoint-recent-");
    const repoDir = path.join(cwd, "repo");
    await mkdirWorkspaceDir(repoDir, { recursive: true });
    initGitRepo(repoDir);
    const orphanedSha = await commitFile(repoDir, "a.ts", "export const a = 1;\n", "add a.ts");
    await orphanLastCommit(repoDir, "a.ts", "export const a = 2;\n");
    const headSha = gitHeadCommitForTest(repoDir);
    await writeConfig(cwd, "my-app", repoDir);

    const state = {
      stateVersion: 2,
      agents: {
        "my-app": {
          agentId: "agent-1",
          repoName: "my-app",
          passages: {},
          lastBootstrap: null,
          lastSyncCommit: orphanedSha,
          lastSyncAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };
    await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf8");

    const result = runCli(["sync", "--config", "config.yaml"], cwd, { REPO_EXPERT_TEST_FAKE_PROVIDER: "1" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`checkpoint commit ${orphanedSha.slice(0, 7)} no longer exists`);
    expect(result.stderr).toContain("Refusing to guess a diff window");
    expect(result.stdout).not.toContain("changed files since");

    // The stored checkpoint is authoritative: state must be left untouched.
    const savedState = JSON.parse(await readWorkspaceFile(path.join(cwd, ".repo-expert-state.json"))) as {
      agents: Record<string, { lastSyncCommit: string }>;
    };
    expect(savedState.agents["my-app"].lastSyncCommit).toBe(orphanedSha);
    expect(headSha).not.toBe(orphanedSha);
  });

  it("auto-consolidates after sync via checkpoint-range git evidence when consolidate_on_sync is enabled", { timeout: 30_000 }, async () => {
    const cwd = await makeWorkspace("repo-expert-cli-sync-consolidate-checkpoint-");
    const repoDir = path.join(cwd, "repo");
    await mkdirWorkspaceDir(repoDir, { recursive: true });
    initGitRepo(repoDir);
    const checkpointSha = await commitFile(repoDir, "a.ts", "export const a = 1;\n", "add a.ts");
    await commitFile(repoDir, "b.ts", "export const b = 2;\n", "add b.ts");
    await commitFile(repoDir, "c.ts", "export const c = 3;\n", "add c.ts");
    await commitFile(repoDir, "d.ts", "export const d = 4;\n", "add d.ts");
    await commitFile(repoDir, "e.ts", "export const e = 5;\n", "add e.ts");
    await commitFile(repoDir, "f.ts", "export const f = 6;\n", "add f.ts");
    const headSha = gitHeadCommitForTest(repoDir);
    await writeConfig(cwd, "my-app", repoDir, { consolidateOnSync: true });

    const state = {
      stateVersion: 2,
      agents: {
        "my-app": {
          agentId: "agent-1",
          repoName: "my-app",
          passages: {},
          lastBootstrap: null,
          lastSyncCommit: checkpointSha,
          lastSyncAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };
    await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf8");

    const result = runCli(["sync", "--config", "config.yaml"], cwd, {
      REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
      REPO_EXPERT_TEST_ECHO_PROMPT: "1",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("5 changed files since");
    expect(result.stdout).toContain("Consolidated architecture/conventions memory blocks.");
    // Evidence actually reached the prompt, not just an empty placeholder.
    expect(result.stdout).toContain("Commit log since the last sync");
    expect(result.stdout).toContain("add f.ts");

    const savedState = JSON.parse(await readWorkspaceFile(path.join(cwd, ".repo-expert-state.json"))) as {
      agents: Record<string, { lastSyncCommit: string; lastConsolidatedCommit?: string | null }>;
    };
    expect(savedState.agents["my-app"].lastSyncCommit).toBe(headSha);
    expect(savedState.agents["my-app"].lastConsolidatedCommit).toBe(headSha);
  });

  it("auto-consolidates after sync via an explicit --since ref", { timeout: 30_000 }, async () => {
    const cwd = await makeWorkspace("repo-expert-cli-sync-consolidate-since-");
    const repoDir = path.join(cwd, "repo");
    await mkdirWorkspaceDir(repoDir, { recursive: true });
    initGitRepo(repoDir);
    const sinceSha = await commitFile(repoDir, "a.ts", "export const a = 1;\n", "add a.ts");
    await commitFile(repoDir, "b.ts", "export const b = 2;\n", "add b.ts");
    await commitFile(repoDir, "c.ts", "export const c = 3;\n", "add c.ts");
    await commitFile(repoDir, "d.ts", "export const d = 4;\n", "add d.ts");
    await commitFile(repoDir, "e.ts", "export const e = 5;\n", "add e.ts");
    await commitFile(repoDir, "f.ts", "export const f = 6;\n", "add f.ts");
    const headSha = gitHeadCommitForTest(repoDir);
    await writeConfig(cwd, "my-app", repoDir, { consolidateOnSync: true });

    // No stored checkpoint: without --since this would hit the "no previous
    // sync" skip branch, proving the evidence below comes from the explicit ref.
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
    await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf8");

    const result = runCli(["sync", "--config", "config.yaml", "--since", sinceSha], cwd, {
      REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
      REPO_EXPERT_TEST_ECHO_PROMPT: "1",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("5 changed files since");
    expect(result.stdout).toContain("Consolidated architecture/conventions memory blocks.");
    expect(result.stdout).toContain("Commit log since the last sync");
    expect(result.stdout).toContain("add f.ts");

    const savedState = JSON.parse(await readWorkspaceFile(path.join(cwd, ".repo-expert-state.json"))) as {
      agents: Record<string, { lastConsolidatedCommit?: string | null }>;
    };
    expect(savedState.agents["my-app"].lastConsolidatedCommit).toBe(headSha);
  });

  it("auto-consolidates after a full re-index sync with git evidence omitted", { timeout: 30_000 }, async () => {
    const cwd = await makeWorkspace("repo-expert-cli-sync-consolidate-full-");
    const repoDir = path.join(cwd, "repo");
    await mkdirWorkspaceDir(repoDir, { recursive: true });
    initGitRepo(repoDir);
    await commitFile(repoDir, "a.ts", "export const a = 1;\n", "add a.ts");
    await commitFile(repoDir, "b.ts", "export const b = 2;\n", "add b.ts");
    await commitFile(repoDir, "c.ts", "export const c = 3;\n", "add c.ts");
    await commitFile(repoDir, "d.ts", "export const d = 4;\n", "add d.ts");
    await commitFile(repoDir, "e.ts", "export const e = 5;\n", "add e.ts");
    const headSha = gitHeadCommitForTest(repoDir);
    await writeConfig(cwd, "my-app", repoDir, { consolidateOnSync: true });

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
    await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf8");

    const result = runCli(["sync", "--config", "config.yaml", "--full"], cwd, {
      REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
      REPO_EXPERT_TEST_ECHO_PROMPT: "1",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("full re-index");
    expect(result.stdout).toContain("Git evidence omitted from consolidation: full re-index has no diff window.");
    expect(result.stdout).toContain("Consolidated architecture/conventions memory blocks.");
    // No git evidence was gathered, so the prompt must not carry an evidence section.
    expect(result.stdout).not.toContain("Commit log since the last sync");

    const savedState = JSON.parse(await readWorkspaceFile(path.join(cwd, ".repo-expert-state.json"))) as {
      agents: Record<string, { lastConsolidatedCommit?: string | null }>;
    };
    expect(savedState.agents["my-app"].lastConsolidatedCommit).toBe(headSha);
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
    await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf8");

    const result = runCli(["status", "--json"], cwd, {
      REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
    });

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as Array<{ repoName: string }>;
    expect(payload[0].repoName).toBe("my-app");
  });

  it("runs the consolidate command against a repo agent", { timeout: 30_000 }, async () => {
    const cwd = await makeWorkspace("repo-expert-cli-consolidate-");
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
    await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf8");

    const result = runCli(["consolidate", "--repo", "my-app"], cwd, {
      REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Consolidating memory for "my-app"');
    expect(result.stdout).toContain("Done.");
  });

  it("consolidate reports a skip when the provider fails, without erroring", { timeout: 30_000 }, async () => {
    const cwd = await makeWorkspace("repo-expert-cli-consolidate-fail-");
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
    await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf8");

    const result = runCli(["consolidate", "--repo", "my-app"], cwd, {
      REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
      REPO_EXPERT_TEST_FAIL_CONSOLIDATE_ONCE: "1",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Skipped");
  });

  it("manual consolidate gathers checkpoint-range git evidence against a real repo and stamps lastConsolidatedCommit", { timeout: 30_000 }, async () => {
    const cwd = await makeWorkspace("repo-expert-cli-consolidate-checkpoint-");
    const repoDir = path.join(cwd, "repo");
    await mkdirWorkspaceDir(repoDir, { recursive: true });
    initGitRepo(repoDir);
    const checkpointSha = await commitFile(repoDir, "a.ts", "export const a = 1;\n", "add a.ts");
    await commitFile(repoDir, "b.ts", "export const b = 2;\n", "add feature b.ts");
    const headSha = gitHeadCommitForTest(repoDir);
    expect(headSha).not.toBe(checkpointSha);
    await writeConfig(cwd, "my-app", repoDir);

    const state = {
      stateVersion: 2,
      agents: {
        "my-app": {
          agentId: "agent-1",
          repoName: "my-app",
          passages: {},
          lastBootstrap: null,
          lastSyncCommit: checkpointSha,
          lastSyncAt: null,
          lastConsolidatedCommit: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };
    await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf8");

    const result = runCli(["consolidate", "--repo", "my-app", "--config", "config.yaml"], cwd, {
      REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
      REPO_EXPERT_TEST_ECHO_PROMPT: "1",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Consolidating memory for "my-app"');
    expect(result.stdout).toContain("Done.");
    // Real git evidence from the checkpoint..HEAD range reached the prompt.
    expect(result.stdout).toContain("Commit log since the last sync");
    expect(result.stdout).toContain("add feature b.ts");

    const savedState = JSON.parse(await readWorkspaceFile(path.join(cwd, ".repo-expert-state.json"))) as {
      agents: Record<string, { lastConsolidatedCommit?: string | null }>;
    };
    expect(savedState.agents["my-app"].lastConsolidatedCommit).toBe(headSha);
  });

  it("manual consolidate skips when HEAD matches both lastSyncCommit and lastConsolidatedCommit", { timeout: 30_000 }, async () => {
    const cwd = await makeWorkspace("repo-expert-cli-consolidate-skip-");
    const repoDir = path.join(cwd, "repo");
    await mkdirWorkspaceDir(repoDir, { recursive: true });
    initGitRepo(repoDir);
    await commitFile(repoDir, "a.ts", "export const a = 1;\n", "add a.ts");
    const headSha = gitHeadCommitForTest(repoDir);
    await writeConfig(cwd, "my-app", repoDir);

    const state = {
      stateVersion: 2,
      agents: {
        "my-app": {
          agentId: "agent-1",
          repoName: "my-app",
          passages: {},
          lastBootstrap: null,
          lastSyncCommit: headSha,
          lastSyncAt: null,
          lastConsolidatedCommit: headSha,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };
    const stateJson = JSON.stringify(state);
    await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), stateJson, "utf8");

    const result = runCli(["consolidate", "--repo", "my-app", "--config", "config.yaml"], cwd, {
      REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
      REPO_EXPERT_TEST_ECHO_PROMPT: "1",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Skipped: no repository changes since last consolidation.");
    // The provider must never be reached once the skip fires.
    expect(result.stdout).not.toContain("[fake-consolidate-prompt]");

    const savedState = await readWorkspaceFile(path.join(cwd, ".repo-expert-state.json"));
    expect(savedState).toBe(stateJson);
  });

  it("manual consolidate fails fast on an orphaned checkpoint, leaving state untouched", { timeout: 30_000 }, async () => {
    const cwd = await makeWorkspace("repo-expert-cli-consolidate-orphan-");
    const repoDir = path.join(cwd, "repo");
    await mkdirWorkspaceDir(repoDir, { recursive: true });
    initGitRepo(repoDir);
    await commitFile(repoDir, "a.ts", "export const a = 1;\n", "add a.ts");
    await writeConfig(cwd, "my-app", repoDir);

    // A checkpoint SHA that never existed in this repo — same effect as one
    // orphaned by rebase/force-push/gc, without needing to reconstruct that history.
    const bogusSha = "abc1234abc1234abc1234abc1234abc1234abcd";

    const state = {
      stateVersion: 2,
      agents: {
        "my-app": {
          agentId: "agent-1",
          repoName: "my-app",
          passages: {},
          lastBootstrap: null,
          lastSyncCommit: bogusSha,
          lastSyncAt: null,
          lastConsolidatedCommit: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };
    const stateJson = JSON.stringify(state);
    await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), stateJson, "utf8");

    const result = runCli(["consolidate", "--repo", "my-app", "--config", "config.yaml"], cwd, {
      REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
      REPO_EXPERT_TEST_ECHO_PROMPT: "1",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`checkpoint commit ${bogusSha.slice(0, 7)} no longer exists`);
    expect(result.stderr).toContain('Re-establish it with "repo-expert sync --since <ref>" or "repo-expert sync --full"');
    // The provider must never be reached once the orphan check fails.
    expect(result.stdout).not.toContain("[fake-consolidate-prompt]");

    const savedState = await readWorkspaceFile(path.join(cwd, ".repo-expert-state.json"));
    expect(savedState).toBe(stateJson);
  });

  it("supports doctor --fix", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-doctor-fix-");
    await writeWorkspaceFile(path.join(cwd, "config.example.yaml"), "provider:\n  model: qwen3-coder:30b\nrepos: {}\n", "utf8");

    const result = runCli(["doctor", "--fix", "--json"], cwd, {
      REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
    });
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as { fixes: { applied: string[] } };
    expect(payload.fixes.applied.length).toBeGreaterThan(0);
    await expect(fs.access(path.join(cwd, ".env"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(cwd, "config.yaml"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(cwd, ".repo-expert-state.json"))).resolves.toBeUndefined();
  });

  it("doctor exits 0 on warnings without --strict", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-doctor-warn-");
    await writeWarnDoctorWorkspace(cwd);

    const result = runCli(["doctor"], cwd, { REPO_EXPERT_TEST_FAKE_PROVIDER: "1" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("WARN");
  });

  it("doctor exits non-zero on warnings with --strict", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-doctor-strict-");
    await writeWarnDoctorWorkspace(cwd);

    const result = runCli(["doctor", "--strict"], cwd, { REPO_EXPERT_TEST_FAKE_PROVIDER: "1" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("WARN");
  });

  it("errors when ask --fast has no model source", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-ask-fast-error-");
    await writeAskWorkspace(cwd, ["  model: qwen3-coder:30b"]);

    const result = runCli(["ask", "my-app", "How does auth work?", "--fast"], cwd, {
      REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--fast requires provider.fast_model in config.yaml or --fast-model");
  });

  it("uses provider.fast_model from config for ask --fast", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-ask-fast-config-");
    await writeAskWorkspace(cwd, ["  model: qwen3-coder:30b", "  fast_model: llama3.2:3b"]);

    const result = runCli(["ask", "my-app", "q", "--fast"], cwd, {
      REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
      REPO_EXPERT_TEST_ECHO_MODEL: "1",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("model=llama3.2:3b");
  });

  it("prefers --fast-model flag over provider.fast_model config", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-ask-fast-precedence-");
    await writeAskWorkspace(cwd, ["  model: qwen3-coder:30b", "  fast_model: config-model"]);

    const result = runCli(["ask", "my-app", "q", "--fast", "--fast-model", "flag-model"], cwd, {
      REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
      REPO_EXPERT_TEST_ECHO_MODEL: "1",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("model=flag-model");
  });

  it("does not apply a fast model when --fast is omitted", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-ask-no-fast-");
    await writeAskWorkspace(cwd, ["  model: qwen3-coder:30b", "  fast_model: config-model"]);

    const result = runCli(["ask", "my-app", "q"], cwd, {
      REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
      REPO_EXPERT_TEST_ECHO_MODEL: "1",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("model=default");
  });

  it("prints a walkthrough for onboard", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-onboard-");
    await writeAskWorkspace(cwd, ["  model: qwen3-coder:30b"]);

    const result = runCli(["onboard", "my-app"], cwd, { REPO_EXPERT_TEST_FAKE_PROVIDER: "1" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ok");
  });

  it("shows a progress indicator while generating the onboarding walkthrough", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-onboard-progress-");
    await writeAskWorkspace(cwd, ["  model: qwen3-coder:30b"]);

    const result = runCli(["onboard", "my-app"], cwd, { REPO_EXPERT_TEST_FAKE_PROVIDER: "1" });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Generating onboarding walkthrough");
  });

  it("times out onboard when the LLM call exceeds --timeout-ms", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-onboard-timeout-");
    await writeAskWorkspace(cwd, ["  model: qwen3-coder:30b"]);

    const result = runCli(["onboard", "my-app", "--timeout-ms", "50"], cwd, {
      REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
      REPO_EXPERT_TEST_DELAY_BOOTSTRAP_MS: "500",
    });

    expect(result.status).toBe(1);
    expect(result.stderr.toLowerCase()).toContain("timed out");
  });

  it("supports self-check --json", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-self-check-");
    await writeWorkspaceFile(
      path.join(cwd, "package.json"),
      JSON.stringify({
        name: "self-check-fixture",
        version: "1.0.0",
        packageManager: "pnpm@10.20.0",
        dependencies: { commander: "^14.0.0" },
      }),
      "utf8",
    );
    await mkdirWorkspaceDir(path.join(cwd, "node_modules", "commander"), { recursive: true });

    const binDir = path.join(cwd, "bin");
    await mkdirWorkspaceDir(binDir, { recursive: true });
    const pnpmStubPath = process.platform === "win32"
      ? path.join(binDir, "pnpm.cmd")
      : path.join(binDir, "pnpm");
    const pnpmStub = process.platform === "win32"
      ? "@echo off\r\necho 10.20.0\r\n"
      : "#!/usr/bin/env sh\necho 10.20.0\n";
    await writeWorkspaceFile(pnpmStubPath, pnpmStub, "utf8");
    if (process.platform !== "win32") {
      await chmodWorkspaceFile(pnpmStubPath, 0o755);
    }

    const result = runCli(["self-check", "--json"], cwd, {
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    });
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as Array<{ name: string; status: string }>;
    const names = payload.map((row) => row.name);
    expect(names).toContain("Node.js");
    expect(names).toContain("pnpm");
    expect(names).toContain("dependencies");
    expect(payload.some((row) => row.status === "fail")).toBe(false);
  });

  it("supports config lint --json for valid config", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-config-lint-ok-");
    const repoDir = path.join(cwd, "repo");
    await mkdirWorkspaceDir(repoDir, { recursive: true });
    await writeConfig(cwd, "my-app", repoDir);

    const result = runCli(["config", "lint", "--config", "config.yaml", "--json"], cwd);
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      repoCount: number;
      repos: string[];
    };
    expect(payload.ok).toBe(true);
    expect(payload.repoCount).toBe(1);
    expect(payload.repos).toEqual(["my-app"]);
  });

  it("reports config lint failures in JSON", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-config-lint-fail-");
    const invalidConfig = [
      "provider:",
      "  model: qwen3-coder:30b",
      "repos:",
      "  bad-repo:",
      "    path: /tmp/bad-repo",
      "    description: bad",
      "    extensions: [ts]",
      "    ignore_dirs: [node_modules]",
    ].join("\n");
    await writeWorkspaceFile(path.join(cwd, "config.yaml"), invalidConfig, "utf8");

    const result = runCli(["config", "lint", "--config", "config.yaml", "--json"], cwd);
    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout) as { ok: boolean; issues: string[] };
    expect(payload.ok).toBe(false);
    expect(payload.issues[0]).toContain("should start with \".\"");
  });

  it("prints bash completion script", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-completion-stdout-");
    const result = runCli(["completion", "bash"], cwd);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("bash completion for repo-expert");
    expect(result.stdout).toContain("complete -F _repo_expert_completion repo-expert");
  });

  it("writes completion script with --install-dir", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-completion-install-");
    const installDir = path.join(cwd, "completions");
    const result = runCli(["completion", "fish", "--install-dir", installDir], cwd);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Completion script written");
    const script = await readWorkspaceFile(path.join(installDir, "repo-expert.fish"), "utf8");
    expect(script).toContain("fish completion for repo-expert");
  });

  it("setup fails fast with an actionable message when the LLM endpoint is unreachable", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-setup-preflight-fail-");
    await writeUnreachableSetupWorkspace(cwd);

    const result = runCli(["setup", "--config", "config.yaml"], cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("http://127.0.0.1:1");
    expect(result.stderr.toLowerCase()).toContain("ollama serve");
    // No indexing work should have started — no state file should be created.
    await expect(fs.access(path.join(cwd, ".repo-expert-state.json"))).rejects.toThrow();
  });

  it("setup --skip-preflight bypasses the endpoint check and proceeds", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-setup-preflight-skip-");
    await writeUnreachableSetupWorkspace(cwd);

    const result = runCli(["setup", "--config", "config.yaml", "--skip-preflight", "--no-bootstrap"], cwd, {
      REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Setup complete.");
    expect(result.stderr).not.toContain("ollama serve");
  });

  it("supports setup --reindex and emits JSON timings", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-setup-reindex-");
    const repoDir = path.join(cwd, "repo");
    await mkdirWorkspaceDir(repoDir, { recursive: true });
    await writeWorkspaceFile(path.join(repoDir, "a.ts"), "export const a = 1;\n", "utf8");
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
    await writeWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify(state), "utf8");

    const result = runCli(
      ["setup", "--config", "config.yaml", "--reindex", "--json", "--no-bootstrap"],
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
    await mkdirWorkspaceDir(repoDir, { recursive: true });
    await writeWorkspaceFile(path.join(repoDir, "a.ts"), "export const a = 1;\n", "utf8");
    await writeConfig(cwd, "my-app", repoDir);

    const first = runCli(
      ["setup", "--config", "config.yaml", "--json", "--load-retries", "0", "--load-timeout-ms", "1", "--no-bootstrap"],
      cwd,
      {
        REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
        REPO_EXPERT_TEST_DELAY_STORE_MS: "100",
      },
    );
    expect(first.status).toBe(1);
    const firstPayload = JSON.parse(first.stdout) as { results: Array<{ status: string }> };
    expect(firstPayload.results[0].status).toBe("error");

    const stateRaw = await readWorkspaceFile(path.join(cwd, ".repo-expert-state.json"), "utf8");
    const state = JSON.parse(stateRaw) as { agents: Record<string, unknown> };
    expect(state.agents["my-app"]).toBeDefined();

    const second = runCli(
      ["setup", "--config", "config.yaml", "--resume", "--json", "--no-bootstrap"],
      cwd,
      { REPO_EXPERT_TEST_FAKE_PROVIDER: "1" },
    );
    expect(second.status).toBe(0);
    const secondPayload = JSON.parse(second.stdout) as { results: Array<{ status: string; mode: string }> };
    expect(secondPayload.results[0].status).toBe("ok");
    expect(secondPayload.results[0].mode).toBe("resume_full");
  });

  it("handles SIGINT during setup without corrupting state", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-chaos-sigint-");
    const repoDir = path.join(cwd, "repo");
    await mkdirWorkspaceDir(repoDir, { recursive: true });
    await mkdirWorkspaceDir(path.join(repoDir, ".git"), { recursive: true });
    for (let i = 0; i < 100; i++) {
      await writeWorkspaceFile(path.join(repoDir, `file-${String(i)}.ts`), `export const n${String(i)} = ${String(i)};\n`, "utf8");
    }
    await writeConfig(cwd, "my-app", repoDir);

    const child = spawn(tsxBinPath(), [cliEntryPath, "setup", "--config", "config.yaml", "--no-bootstrap"], {
      cwd,
      env: {
        ...process.env,
        REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
        REPO_EXPERT_TEST_DELAY_STORE_MS: "100",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await new Promise<void>((resolve) => {
      child.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("Loading")) resolve();
      });
    });
    child.kill("SIGINT");
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on("exit", (code, signal) => { resolve({ code, signal }); });
    });

    expect(exit.code === 130 || exit.signal === "SIGINT").toBe(true);

    const statePath = path.join(cwd, ".repo-expert-state.json");
    const raw = await readWorkspaceFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as { agents: Record<string, unknown> };
    expect(parsed.agents["my-app"]).toBeDefined();
  });

  it("meets setup performance budget on fixture repo", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-perf-setup-");
    const repoDir = path.join(cwd, "repo");
    await mkdirWorkspaceDir(repoDir, { recursive: true });
    await mkdirWorkspaceDir(path.join(repoDir, ".git"), { recursive: true });
    for (let i = 0; i < 120; i++) {
      await writeWorkspaceFile(
        path.join(repoDir, `feature-${String(i)}.ts`),
        `export const feature${String(i)} = ${String(i)};\n`,
        "utf8",
      );
    }
    await writeConfig(cwd, "my-app", repoDir);

    const result = runCli(
      ["setup", "--config", "config.yaml", "--json", "--no-bootstrap"],
      cwd,
      { REPO_EXPERT_TEST_FAKE_PROVIDER: "1" },
    );
    expect(result.status).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      results: Array<{ totalMs: number; filesFound: number }>;
    };
    expect(payload.results[0].filesFound).toBe(120);
    expect(payload.results[0].totalMs).toBeLessThan(12_000);
  });
});
