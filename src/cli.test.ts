import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { spawn, spawnSync } from "child_process";
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
    encoding: "utf-8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function normalizeOutput(text: string): string {
  const rawLines = text.replace(/\r\n/g, "\n").trim().split("\n");
  const normalized: string[] = [];

  for (const rawLine of rawLines) {
    const collapsed = rawLine.trim().replace(/\s+/g, " ");
    if (!collapsed) {
      normalized.push("");
      continue;
    }
    const isContinuation = /^\s{20,}\S/.test(rawLine);
    if (isContinuation && normalized.length > 0 && normalized[normalized.length - 1] !== "") {
      normalized[normalized.length - 1] = `${normalized[normalized.length - 1]} ${collapsed}`;
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
      init [options] Interactive setup: configure API key, scan a repo, generate config.yaml
      doctor [options] Check setup: API key, config, repo paths, git, state consistency
      self-check [options] Check local runtime/toolchain health (Node, pnpm, dependencies)
      setup [options] Create agents from config.yaml
      config Configuration helpers
      ask [options] [repo] [question] Ask an agent a question
      sync [options] Sync file changes to agents
      list [options] List all agents
      status [options] Show agent memory stats and health
      export [options] Export agent memory to markdown
      onboard <repo> Guided codebase walkthrough for new developers
      destroy [options] Delete agents
      reconcile [options] Compare local passage state against Letta's actual state and report drift
      sleeptime [options] Enable sleep-time memory consolidation on existing agents
      watch [options] Watch repos and auto-sync on repo changes
      install-daemon [options] Install launchd daemon for auto-sync on macOS
      uninstall-daemon Uninstall the launchd watch daemon
      mcp-install [options] Add Letta MCP server entry to Claude Code config
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
      --json Output setup results as JSON
      --load-retries <n> Retries for passage loading (default: "2")
      --bootstrap-retries <n> Retries for bootstrap stage (default: "2")
      --load-timeout-ms <ms> Timeout for passage loading stage (default: "300000")
      --bootstrap-timeout-ms <ms> Timeout for bootstrap stage (default: "120000")
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
    await fs.writeFile(path.join(cwd, ".repo-expert-state.json"), JSON.stringify({ stateVersion: 2, agents: {} }), "utf-8");

    const cases = [
      {
        args: ["--no-input", "destroy"] as string[],
        expectedStatus: 0,
        expectedStdout: "No agents to destroy.",
      },
      {
        args: ["--no-input", "init"] as string[],
        expectedStatus: 1,
        expectedStderr: "API key is required in non-interactive mode.",
      },
    ];

    for (const testCase of cases) {
      const result = runCli(testCase.args, cwd, { LETTA_API_KEY: "" });
      expect(result.status).toBe(testCase.expectedStatus);
      if (testCase.expectedStderr) {
        expect(result.stderr).toContain(testCase.expectedStderr);
      }
      if (testCase.expectedStdout) {
        expect(result.stdout).toContain(testCase.expectedStdout);
      }
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

  it("supports self-check --json", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-self-check-");
    await fs.writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({
        name: "self-check-fixture",
        version: "1.0.0",
        packageManager: "pnpm@10.20.0",
        dependencies: { commander: "^14.0.0" },
      }),
      "utf-8",
    );
    await fs.mkdir(path.join(cwd, "node_modules", "commander"), { recursive: true });

    const binDir = path.join(cwd, "bin");
    await fs.mkdir(binDir, { recursive: true });
    const pnpmStubPath = process.platform === "win32"
      ? path.join(binDir, "pnpm.cmd")
      : path.join(binDir, "pnpm");
    const pnpmStub = process.platform === "win32"
      ? "@echo off\r\necho 10.20.0\r\n"
      : "#!/usr/bin/env sh\necho 10.20.0\n";
    await fs.writeFile(pnpmStubPath, pnpmStub, "utf-8");
    if (process.platform !== "win32") {
      await fs.chmod(pnpmStubPath, 0o755);
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
    await fs.mkdir(repoDir, { recursive: true });
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
      "letta:",
      "  model: openai/gpt-4.1",
      "  embedding: openai/text-embedding-3-small",
      "repos:",
      "  bad-repo:",
      "    path: /tmp/bad-repo",
      "    description: bad",
      "    extensions: [ts]",
      "    ignore_dirs: [node_modules]",
    ].join("\n");
    await fs.writeFile(path.join(cwd, "config.yaml"), invalidConfig, "utf-8");

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
    const script = await fs.readFile(path.join(installDir, "repo-expert.fish"), "utf-8");
    expect(script).toContain("fish completion for repo-expert");
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
      ["setup", "--config", "config.yaml", "--json", "--load-retries", "0", "--load-timeout-ms", "1"],
      cwd,
      {
        REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
        REPO_EXPERT_TEST_DELAY_STORE_MS: "100",
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

  it("handles SIGINT during setup without corrupting state", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-chaos-sigint-");
    const repoDir = path.join(cwd, "repo");
    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(path.join(repoDir, ".git"), { recursive: true });
    for (let i = 0; i < 100; i++) {
      await fs.writeFile(path.join(repoDir, `file-${i}.ts`), `export const n${i} = ${i};\n`, "utf-8");
    }
    await writeConfig(cwd, "my-app", repoDir);

    const child = spawn(tsxBinPath(), [cliEntryPath, "setup", "--config", "config.yaml"], {
      cwd,
      env: {
        ...process.env,
        REPO_EXPERT_TEST_FAKE_PROVIDER: "1",
        REPO_EXPERT_TEST_DELAY_STORE_MS: "100",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await new Promise<void>((resolve) => {
      child.stdout!.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("Loading")) resolve();
      });
    });
    child.kill("SIGINT");
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on("exit", (code, signal) => resolve({ code, signal }));
    });

    expect(exit.code === 130 || exit.signal === "SIGINT").toBe(true);

    const statePath = path.join(cwd, ".repo-expert-state.json");
    const raw = await fs.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as { agents: Record<string, unknown> };
    expect(parsed.agents["my-app"]).toBeDefined();
  });

  it("meets setup performance budget on fixture repo", async () => {
    const cwd = await makeWorkspace("repo-expert-cli-perf-setup-");
    const repoDir = path.join(cwd, "repo");
    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(path.join(repoDir, ".git"), { recursive: true });
    for (let i = 0; i < 120; i++) {
      await fs.writeFile(path.join(repoDir, `feature-${i}.ts`), `export const feature${i} = ${i};\n`, "utf-8");
    }
    await writeConfig(cwd, "my-app", repoDir);

    const result = runCli(
      ["setup", "--config", "config.yaml", "--json"],
      cwd,
      { REPO_EXPERT_TEST_FAKE_PROVIDER: "1" },
    );
    expect(result.status).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      results: Array<{ totalMs: number; filesFound: number }>;
    };
    expect(payload.results[0].filesFound).toBe(120);
    expect(payload.results[0].totalMs).toBeLessThan(12000);
  });
});
