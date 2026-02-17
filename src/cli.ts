#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { Letta } from "@letta-ai/letta-client";
import * as path from "path";
import * as readline from "readline/promises";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { loadConfig } from "./shell/config-loader.js";
import { runInit } from "./shell/init.js";
import { runAllChecks } from "./shell/doctor.js";
import { formatDoctorReport } from "./core/doctor.js";
import { ConfigError, formatConfigError } from "./core/config.js";
import { collectFiles } from "./shell/file-collector.js";
import { loadState, saveState } from "./shell/state-store.js";
import { createRepoAgent, loadPassages } from "./shell/agent-factory.js";
import { bootstrapAgent } from "./shell/bootstrap.js";
import { LettaProvider } from "./shell/letta-provider.js";
import { rawTextStrategy } from "./core/chunker.js";
import { shouldIncludeFile } from "./core/filter.js";
import { addAgentToState, removeAgentFromState, updateAgentField, updatePassageMap } from "./core/state.js";
import { syncRepo } from "./shell/sync.js";
import { getAgentStatus } from "./shell/status.js";
import { exportAgent } from "./shell/export.js";
import { onboardAgent } from "./shell/onboard.js";
import { broadcastAsk } from "./shell/group-provider.js";
import { watchRepos } from "./shell/watch.js";
import { DEFAULT_WATCH_CONFIG } from "./core/watch.js";
import { generatePlist, PLIST_LABEL } from "./core/daemon.js";
import { generateMcpEntry, checkMcpEntry } from "./core/mcp-config.js";
import type { AgentState, AppState, Config } from "./core/types.js";

interface SetupOpts {
  repo?: string;
  config: string;
}

interface ProgramOpts {
  noInput?: boolean;
  debug?: boolean;
}

interface DoctorOpts {
  config: string;
  json?: boolean;
}

interface AskOpts {
  all?: boolean;
  interactive?: boolean;
  timeout: string;
}

interface SyncOpts {
  repo?: string;
  full?: boolean;
  since?: string;
  config: string;
}

interface RepoOpts {
  repo?: string;
  json?: boolean;
}

interface DestroyOpts {
  repo?: string;
  force?: boolean;
}

interface WatchOpts {
  repo?: string;
  interval: string;
  config: string;
}

interface InstallDaemonOpts {
  interval: string;
  config: string;
}

const STATE_FILE = ".repo-expert-state.json";

// --- Helpers ---

class CliUserError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliUserError";
    this.exitCode = exitCode;
  }
}

function requireApiKey(): void {
  if (!process.env.LETTA_API_KEY) {
    throw new CliUserError('Missing LETTA_API_KEY.\nRun "repo-expert init" to configure, or add it to .env manually.');
  }
}

function createProvider(): LettaProvider {
  requireApiKey();
  return new LettaProvider(new Letta({ timeout: 5 * 60 * 1000 }));
}

async function loadConfigSafe(configPath: string): Promise<Config> {
  try {
    return await loadConfig(configPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CliUserError(`Config file not found: ${configPath}\nRun "repo-expert init" or copy config.example.yaml to config.yaml.`);
    }
    if (err instanceof ConfigError) {
      throw new CliUserError(formatConfigError(err));
    }
    throw err;
  }
}

function gitHeadCommit(cwd: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function requireAgent(state: AppState, repoName: string): AgentState | null {
  const agentInfo = state.agents[repoName];
  if (!agentInfo) {
    if (Object.keys(state.agents).length === 0) {
      console.error(`No agents found. Run "repo-expert setup" to create them.`);
    } else {
      console.error(`No agent found for "${repoName}". Available: ${Object.keys(state.agents).join(", ")}`);
    }
    process.exitCode = 1;
    return null;
  }
  return agentInfo;
}

function parseIntOrDefault(value: string, fallback: number): number {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

function printProgress(loaded: number, total: number): void {
  process.stdout.write(`\r  Loading passages: ${loaded}/${total}`);
}

function noInputEnabled(): boolean {
  return process.argv.includes("--no-input") || Boolean(program.opts<ProgramOpts>().noInput);
}

function interactiveInputAvailable(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function readDebugEnabled(argv: string[]): boolean {
  return argv.includes("--debug");
}

// --- Program ---

const program = new Command();
program.name("repo-expert").description("Persistent AI agents for git repositories").version("0.1.0");
program.option("--no-input", "Disable interactive prompts").option("--debug", "Show stack traces for unexpected errors");
program.addHelpText(
  "after",
  [
    "",
    "Examples:",
    "  repo-expert init",
    "  repo-expert setup",
    '  repo-expert ask my-app "Where is auth?"',
    "  repo-expert list --json",
  ].join("\n"),
);

program
  .command("init")
  .description("Interactive setup: configure API key, scan a repo, generate config.yaml")
  .action(async () => {
    if (noInputEnabled()) {
      console.error("init requires interactive input. Re-run without --no-input.");
      process.exitCode = 1;
      return;
    }
    if (!interactiveInputAvailable()) {
      console.error("init requires an interactive terminal (TTY).");
      process.exitCode = 1;
      return;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      await runInit(rl);
    } catch {
      // runInit sets process.exitCode and logs errors
    } finally {
      rl.close();
    }
  });

program
  .command("doctor")
  .description("Check setup: API key, config, repo paths, git, state consistency")
  .option("--config <path>", "Config file path", "config.yaml")
  .option("--json", "Output checks as JSON")
  .action(async (opts: DoctorOpts) => {
    const configPath = path.resolve(opts.config);
    let provider: LettaProvider | null = null;
    if (process.env.LETTA_API_KEY) {
      provider = new LettaProvider(new Letta({ timeout: 10_000 }));
    }
    const results = await runAllChecks(provider, configPath);
    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(formatDoctorReport(results));
    }
    const hasFailures = results.some((r) => r.status === "fail");
    if (hasFailures) process.exitCode = 1;
  });

program
  .command("setup")
  .description("Create agents from config.yaml")
  .option("--repo <name>", "Set up a single repo")
  .option("--config <path>", "Config file path", "config.yaml")
  .action(async (opts: SetupOpts) => {
    const configPath = path.resolve(opts.config);
    const config = await loadConfigSafe(configPath);
    const provider = createProvider();
    let state = await loadState(STATE_FILE);

    const repoNames = opts.repo ? [opts.repo] : Object.keys(config.repos);

    for (const repoName of repoNames) {
      const repoConfig = config.repos[repoName];
      if (!repoConfig) {
        console.error(`Repo "${repoName}" not found in config`);
        process.exitCode = 1;
        return;
      }

      if (state.agents[repoName]) {
        console.log(`Agent for "${repoName}" already exists (${state.agents[repoName].agentId}), skipping`);
        continue;
      }

      console.log(`Setting up "${repoName}"...`);

      const agentState = await createRepoAgent(provider, repoName, repoConfig, config.letta);
      console.log(`  Agent created: ${agentState.agentId}`);
      state = addAgentToState(state, repoName, agentState.agentId, new Date().toISOString());

      console.log(`  Collecting files from ${repoConfig.path}...`);
      const files = await collectFiles(repoConfig);
      console.log(`  Found ${files.length} files`);

      const chunks = files.flatMap((f) => rawTextStrategy(f));
      console.log(`  Loading ${chunks.length} passages...`);
      const passageMap = await loadPassages(provider, agentState.agentId, chunks, 20, printProgress);
      if (chunks.length > 0) process.stdout.write("\n");
      state = updatePassageMap(state, repoName, passageMap);

      // Store HEAD commit so incremental sync works immediately
      const headCommit = gitHeadCommit(repoConfig.path);
      if (headCommit) {
        state = updateAgentField(state, repoName, { lastSyncCommit: headCommit });
      }

      if (repoConfig.bootstrapOnCreate) {
        console.log(`  Bootstrapping...`);
        await bootstrapAgent(provider, agentState.agentId);
        state = updateAgentField(state, repoName, { lastBootstrap: new Date().toISOString() });
        console.log(`  Bootstrap complete`);
      }

      await saveState(STATE_FILE, state);
      console.log(`  Done: "${repoName}"`);
    }

    console.log("Setup complete.");
  });

program
  .command("ask [repo] [question]")
  .description("Ask an agent a question")
  .option("--all", "Ask all agents and collect responses")
  .option("-i, --interactive", "Interactive REPL mode")
  .option("--timeout <ms>", "Per-agent timeout for --all (ms)", "30000")
  .action(async (repo: string | undefined, question: string | undefined, opts: AskOpts) => {
    if (opts.interactive) {
      if (noInputEnabled()) {
        console.error("Interactive mode is disabled by --no-input.");
        process.exitCode = 1;
        return;
      }
      if (!interactiveInputAvailable()) {
        console.error("Interactive mode requires an interactive terminal (TTY).");
        process.exitCode = 1;
        return;
      }

      const state = await loadState(STATE_FILE);
      const repoNames = Object.keys(state.agents);
      if (repoNames.length === 0) {
        console.error('No agents found. Run "repo-expert setup" to create them.');
        process.exitCode = 1;
        return;
      }

      const provider = createProvider();
      const defaultRepo = repo && state.agents[repo] ? repo : undefined;

      console.log("Interactive mode. Use @repo to target a specific agent.");
      console.log(`Available agents: ${repoNames.join(", ")}`);
      if (defaultRepo) console.log(`Default agent: ${defaultRepo}`);
      console.log('Type "exit" to leave.\n');

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        while (true) {
          const input = await rl.question("> ");
          const trimmed = input.trim();
          if (!trimmed || trimmed === "exit" || trimmed === "quit") break;

          let targetRepo: string | undefined;
          let q: string;

          if (trimmed.startsWith("@")) {
            const spaceIdx = trimmed.indexOf(" ");
            if (spaceIdx === -1) {
              console.log("Usage: @repo question");
              continue;
            }
            targetRepo = trimmed.slice(1, spaceIdx);
            q = trimmed.slice(spaceIdx + 1).trim();
          } else {
            targetRepo = defaultRepo;
            q = trimmed;
          }

          if (!targetRepo) {
            console.log("No default agent. Use @repo question.");
            continue;
          }

          const agentInfo = state.agents[targetRepo];
          if (!agentInfo) {
            console.log(`No agent for "${targetRepo}". Available: ${repoNames.join(", ")}`);
            continue;
          }

          const answer = await provider.sendMessage(agentInfo.agentId, q);
          console.log(`\n${answer}\n`);
        }
      } finally {
        rl.close();
      }
      return;
    }

    if (opts.all) {
      // When --all is used, the first positional arg is the question
      const actualQuestion = repo;
      if (!actualQuestion) {
        console.error("Usage: repo-expert ask --all <question>");
        process.exitCode = 1;
        return;
      }

      const state = await loadState(STATE_FILE);
      const entries = Object.entries(state.agents);
      if (entries.length === 0) {
        console.error('No agents found. Run "repo-expert setup" to create them.');
        process.exitCode = 1;
        return;
      }

      const provider = createProvider();
      const agents = entries.map(([repoName, agent]) => ({ repoName, agentId: agent.agentId }));

      console.log(`Broadcasting to ${agents.length} agents...`);
      const results = await broadcastAsk(provider, agents, actualQuestion, {
        timeoutMs: parseIntOrDefault(opts.timeout, 30_000),
      });

      for (const result of results) {
        console.log(`\n--- ${result.repoName} ---`);
        if (result.error) {
          console.error(`  Error: ${result.error}`);
        } else {
          console.log(result.response);
        }
      }
      return;
    }

    // Single agent query
    if (!repo || !question) {
      console.error("Usage: repo-expert ask <repo> <question>");
      console.error("       repo-expert ask --all <question>");
      console.error("       repo-expert ask -i [repo]");
      process.exitCode = 1;
      return;
    }

    const state = await loadState(STATE_FILE);
    const agentInfo = requireAgent(state, repo);
    if (!agentInfo) return;

    const provider = createProvider();
    const answer = await provider.sendMessage(agentInfo.agentId, question);
    console.log(answer);
  });

program
  .command("sync")
  .description("Sync file changes to agents")
  .option("--repo <name>", "Sync a single repo")
  .option("--full", "Full re-index instead of incremental")
  .option("--since <ref>", "Git ref to diff from (overrides stored commit)")
  .option("--config <path>", "Config file path", "config.yaml")
  .action(async (opts: SyncOpts) => {
    const configPath = path.resolve(opts.config);
    const config = await loadConfigSafe(configPath);
    const provider = createProvider();
    let state = await loadState(STATE_FILE);

    const repoNames = opts.repo ? [opts.repo] : Object.keys(state.agents);

    for (const repoName of repoNames) {
      const agentInfo = requireAgent(state, repoName);
      if (!agentInfo) return;

      const repoConfig = config.repos[repoName];
      if (!repoConfig) {
        console.error(`Repo "${repoName}" not found in config`);
        process.exitCode = 1;
        return;
      }

      const headCommit = gitHeadCommit(repoConfig.path);
      if (!headCommit) {
        console.error(`"${repoName}": not a git repository or git is not available (${repoConfig.path})`);
        process.exitCode = 1;
        return;
      }

      let changedFiles: string[];
      if (opts.full) {
        const files = await collectFiles(repoConfig);
        changedFiles = files.map((f) => f.path);
        console.log(`Syncing "${repoName}" (full re-index, ${changedFiles.length} files)...`);
      } else {
        const sinceRef = opts.since ?? agentInfo.lastSyncCommit;
        if (!sinceRef) {
          console.log(`No previous sync for "${repoName}". Run "repo-expert sync --full" or re-run "repo-expert setup".`);
          continue;
        }

        let diff: string;
        try {
          diff = execFileSync("git", ["diff", "--name-only", `${sinceRef}..HEAD`], {
            cwd: repoConfig.path,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          }).trim();
        } catch {
          console.error(`"${repoName}": git diff failed. Is "${sinceRef}" a valid ref?`);
          process.exitCode = 1;
          return;
        }
        changedFiles = (diff ? diff.split("\n") : []).filter((f) => shouldIncludeFile(f, 0, repoConfig));
        console.log(`Syncing "${repoName}" (${changedFiles.length} changed files since ${sinceRef.slice(0, 7)})...`);
      }

      if (changedFiles.length === 0) {
        console.log(`  No changes to sync.`);
        state = updateAgentField(state, repoName, { lastSyncCommit: headCommit });
        await saveState(STATE_FILE, state);
        continue;
      }

      const result = await syncRepo({
        provider,
        agent: agentInfo,
        changedFiles,
        collectFile: async (filePath) => {
          const absPath = path.join(repoConfig.path, filePath);
          try {
            const fs = await import("fs/promises");
            const content = await fs.readFile(absPath, "utf-8");
            const stat = await fs.stat(absPath);
            return { path: filePath, content, sizeKb: stat.size / 1024 };
          } catch {
            return null;
          }
        },
        headCommit,
      });

      if (result.isFullReIndex) {
        console.log(`  Warning: ${changedFiles.length} files changed — consider --full re-index`);
      }

      console.log(`  Deleted: ${result.filesDeleted} files, Re-indexed: ${result.filesReIndexed} files`);

      state = updateAgentField(state, repoName, { passages: result.passages, lastSyncCommit: result.lastSyncCommit });
      await saveState(STATE_FILE, state);
      console.log(`  Done.`);
    }
  });

program
  .command("list")
  .description("List all agents")
  .option("--json", "Output agent list as JSON")
  .action(async (opts: RepoOpts) => {
    const state = await loadState(STATE_FILE);
    const entries = Object.entries(state.agents);

    if (entries.length === 0) {
      if (opts.json) {
        console.log("[]");
      } else {
        console.log('No agents found. Run "repo-expert setup" to create them.');
      }
      return;
    }

    const rows = entries.map(([repoName, agent]) => ({
      repoName,
      agentId: agent.agentId,
      files: Object.keys(agent.passages).length,
      passages: Object.values(agent.passages).flat().length,
      bootstrapped: Boolean(agent.lastBootstrap),
    }));

    if (opts.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    for (const row of rows) {
      const bootstrap = row.bootstrapped ? "yes" : "no";
      console.log(`  ${row.repoName}: agent=${row.agentId} files=${row.files} passages=${row.passages} bootstrapped=${bootstrap}`);
    }
  });

program
  .command("status")
  .description("Show agent memory stats and health")
  .option("--repo <name>", "Show status for a single repo")
  .action(async (opts: RepoOpts) => {
    const state = await loadState(STATE_FILE);
    const provider = createProvider();
    const repoNames = opts.repo ? [opts.repo] : Object.keys(state.agents);

    for (const repoName of repoNames) {
      const agentInfo = requireAgent(state, repoName);
      if (!agentInfo) return;

      const output = await getAgentStatus(provider, repoName, agentInfo);
      console.log(output);
    }
  });

program
  .command("export")
  .description("Export agent memory to markdown")
  .option("--repo <name>", "Export a single repo agent")
  .action(async (opts: RepoOpts) => {
    const state = await loadState(STATE_FILE);
    const provider = createProvider();
    const repoNames = opts.repo ? [opts.repo] : Object.keys(state.agents);

    for (const repoName of repoNames) {
      const agentInfo = requireAgent(state, repoName);
      if (!agentInfo) return;

      const md = await exportAgent(provider, repoName, agentInfo.agentId);
      console.log(md);
    }
  });

program
  .command("onboard <repo>")
  .description("Guided codebase walkthrough for new developers")
  .action(async (repo: string) => {
    const state = await loadState(STATE_FILE);
    const agentInfo = requireAgent(state, repo);
    if (!agentInfo) return;

    const provider = createProvider();
    const walkthrough = await onboardAgent(provider, repo, agentInfo.agentId);
    console.log(walkthrough);
  });

program
  .command("destroy")
  .description("Delete agents")
  .option("--repo <name>", "Destroy a single repo agent")
  .option("--force", "Skip confirmation prompt")
  .action(async (opts: DestroyOpts) => {
    const state = await loadState(STATE_FILE);
    const repoNames = opts.repo ? [opts.repo] : Object.keys(state.agents);
    const existing = repoNames.filter((n) => state.agents[n]);

    if (existing.length === 0) {
      console.log("No agents to destroy.");
      return;
    }

    if (!opts.force) {
      if (noInputEnabled()) {
        console.error("destroy requires confirmation. Use --force with --no-input for non-interactive runs.");
        process.exitCode = 1;
        return;
      }
      if (!interactiveInputAvailable()) {
        console.error("destroy requires an interactive terminal for confirmation. Use --force in non-interactive environments.");
        process.exitCode = 1;
        return;
      }
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(`Delete ${existing.length} agent(s) (${existing.join(", ")})? [y/N] `);
      rl.close();
      if (answer.trim().toLowerCase() !== "y") {
        console.log("Aborted.");
        return;
      }
    }

    const provider = createProvider();

    for (const repoName of existing) {
      const agentInfo = state.agents[repoName];
      console.log(`Deleting agent for "${repoName}" (${agentInfo.agentId})...`);
      try {
        await provider.deleteAgent(agentInfo.agentId);
      } catch {
        console.warn(`  Warning: could not delete agent ${agentInfo.agentId} from Letta`);
      }
    }

    let newState = state;
    for (const repoName of existing) {
      newState = removeAgentFromState(newState, repoName);
    }
    await saveState(STATE_FILE, newState);
    console.log("Done.");
  });

program
  .command("watch")
  .description("Watch repos and auto-sync on new commits")
  .option("--repo <name>", "Watch a single repo")
  .option("--interval <seconds>", "Poll interval in seconds", String(DEFAULT_WATCH_CONFIG.intervalMs / 1000))
  .option("--config <path>", "Config file path", "config.yaml")
  .action(async (opts: WatchOpts) => {
    const configPath = path.resolve(opts.config);
    const config = await loadConfigSafe(configPath);
    const state = await loadState(STATE_FILE);
    const repoNames = opts.repo ? [opts.repo] : Object.keys(state.agents);

    if (repoNames.length === 0) {
      console.error('No agents found. Run "repo-expert setup" to create them.');
      process.exitCode = 1;
      return;
    }

    for (const name of repoNames) {
      if (!requireAgent(state, name)) return;
      if (!config.repos[name]) {
        console.error(`Repo "${name}" not found in config`);
        process.exitCode = 1;
        return;
      }
    }

    const intervalMs = Math.max(1, parseIntOrDefault(opts.interval, DEFAULT_WATCH_CONFIG.intervalMs / 1000)) * 1000;
    const provider = createProvider();
    const ac = new AbortController();

    const shutdown = () => ac.abort();
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    console.log(`Watching ${repoNames.length} repo(s) (every ${intervalMs / 1000}s). Press Ctrl+C to stop.`);

    await watchRepos({
      provider,
      config,
      repoNames,
      statePath: STATE_FILE,
      intervalMs,
      signal: ac.signal,
    });

    console.log("Watch stopped.");
  });

program
  .command("install-daemon")
  .description("Install launchd daemon for auto-sync on macOS")
  .option("--interval <seconds>", "Poll interval in seconds", "30")
  .option("--config <path>", "Config file path", "config.yaml")
  .action(async (opts: InstallDaemonOpts) => {
    if (process.platform !== "darwin") {
      console.error("install-daemon is only supported on macOS (launchd).");
      process.exitCode = 1;
      return;
    }

    const fs = await import("fs/promises");
    const os = await import("os");
    const home = os.default.homedir();

    // Resolve pnpm: prefer mise shims (stable across node versions), fallback to which
    const shimPath = path.join(home, ".local/share/mise/shims/pnpm");
    let pnpmPath: string;
    try {
      await fs.access(shimPath);
      pnpmPath = shimPath;
    } catch {
      try {
        pnpmPath = execFileSync("which", ["pnpm"], { encoding: "utf-8" }).trim();
      } catch {
        console.error("Cannot find pnpm. Install it and try again.");
        process.exitCode = 1;
        return;
      }
    }

    const plistPath = path.join(home, "Library/LaunchAgents", `${PLIST_LABEL}.plist`);
    const logPath = path.join(home, "Library/Logs/repo-expert-watch.log");

    const plist = generatePlist({
      workingDirectory: process.cwd(),
      pnpmPath,
      intervalSeconds: parseIntOrDefault(opts.interval, 30),
      configPath: opts.config,
      logPath,
    });

    // Unload existing daemon if present
    try {
      execFileSync("launchctl", ["unload", plistPath], { stdio: "pipe" });
    } catch {
      // Not loaded — fine
    }

    await fs.mkdir(path.dirname(plistPath), { recursive: true });
    await fs.writeFile(plistPath, plist, "utf-8");
    console.log(`Plist written: ${plistPath}`);

    execFileSync("launchctl", ["load", plistPath]);
    console.log("Daemon loaded. Watch is running.");
    console.log(`  Logs: ${logPath}`);
    console.log(`  Stop: repo-expert uninstall-daemon`);
  });

program
  .command("uninstall-daemon")
  .description("Uninstall the launchd watch daemon")
  .action(async () => {
    if (process.platform !== "darwin") {
      console.error("uninstall-daemon is only supported on macOS (launchd).");
      process.exitCode = 1;
      return;
    }

    const os = await import("os");
    const fs = await import("fs/promises");
    const home = os.default.homedir();
    const plistPath = path.join(home, "Library/LaunchAgents", `${PLIST_LABEL}.plist`);

    try {
      execFileSync("launchctl", ["unload", plistPath], { stdio: "pipe" });
      console.log("Daemon unloaded.");
    } catch {
      console.log("Daemon was not loaded.");
    }

    try {
      await fs.unlink(plistPath);
      console.log(`Removed ${plistPath}`);
    } catch {
      console.log("Plist file was already removed.");
    }
  });

interface McpInstallOpts {
  global?: boolean;
  local?: boolean;
  baseUrl: string;
}

interface McpCheckOpts {
  json?: boolean;
}

program
  .command("mcp-install")
  .description("Add Letta MCP server entry to Claude Code config")
  .option("--global", "Write to global ~/.claude.json (default)")
  .option("--local", "Write to local ./.claude.json")
  .option("--base-url <url>", "Letta base URL", "https://api.letta.com")
  .action(async (opts: McpInstallOpts) => {
    requireApiKey();
    if (opts.global && opts.local) {
      console.error("Choose either --global or --local, not both.");
      process.exitCode = 1;
      return;
    }

    const fs = await import("fs/promises");
    const os = await import("os");
    const home = os.default.homedir();
    const mcpServerPath = path.resolve("src/mcp-server.ts");
    const configFile = opts.local ? path.resolve(".claude.json") : path.join(home, ".claude.json");

    let config: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(configFile, "utf-8");
      try {
        config = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        throw new CliUserError(`Failed to parse ${configFile}: invalid JSON.`);
      }
    } catch (err) {
      if (err instanceof CliUserError) throw err;
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;
    if (mcpServers.letta) {
      console.log("Existing 'letta' entry found — overwriting.");
    }

    const entry = generateMcpEntry(mcpServerPath, process.env.LETTA_API_KEY!, opts.baseUrl);
    mcpServers.letta = entry;
    config.mcpServers = mcpServers;

    await fs.writeFile(configFile, JSON.stringify(config, null, 2) + "\n", "utf-8");
    console.log(`MCP entry written to ${configFile}`);
    console.log("Restart Claude Code to pick up the change.");
  });

program
  .command("mcp-check")
  .description("Validate existing MCP server entry in Claude Code config")
  .option("--json", "Output check result as JSON")
  .action(async (opts: McpCheckOpts) => {
    const fs = await import("fs/promises");
    const os = await import("os");
    const home = os.default.homedir();
    const mcpServerPath = path.resolve("src/mcp-server.ts");
    const configFile = path.join(home, ".claude.json");

    let config: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(configFile, "utf-8");
      try {
        config = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        console.error(`Failed to parse ${configFile}: invalid JSON.`);
        process.exitCode = 1;
        return;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        console.error(`Config file not found: ${configFile}`);
        process.exitCode = 1;
        return;
      }
      throw err;
    }

    const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;
    const entry = mcpServers.letta as Parameters<typeof checkMcpEntry>[0];
    const result = checkMcpEntry(entry, mcpServerPath);

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
      return;
    }

    if (result.ok) {
      console.log("MCP config looks good.");
    } else {
      console.error("Issues found:");
      for (const issue of result.issues) {
        console.error(`  - ${issue}`);
      }
      console.error('\nRun "repo-expert mcp-install" to fix.');
      process.exitCode = 1;
    }
  });

async function main(argv = process.argv): Promise<void> {
  await program.parseAsync(argv);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    if (err instanceof CliUserError) {
      console.error(err.message);
      process.exitCode = err.exitCode;
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Unexpected error: ${message}`);
    console.error("Run with --debug for stack trace.");
    if (readDebugEnabled(process.argv) && err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exitCode = 1;
  });
}
