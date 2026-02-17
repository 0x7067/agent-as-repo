#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { Letta } from "@letta-ai/letta-client";
import * as path from "path";
import * as readline from "readline/promises";
import { execFileSync } from "child_process";
import { loadConfig } from "./shell/config-loader.js";
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
import type { AgentState, AppState, Config } from "./core/types.js";

interface SetupOpts {
  repo?: string;
  config: string;
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

const STATE_FILE = ".repo-expert-state.json";

// --- Helpers ---

function requireApiKey(): void {
  if (!process.env.LETTA_API_KEY) {
    console.error("Missing LETTA_API_KEY. Set it in your .env file or as an environment variable.");
    process.exit(1);
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
      console.error(`Config file not found: ${configPath}`);
      console.error("Copy config.example.yaml to config.yaml and customize it.");
      process.exit(1);
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
    console.error(`No agent found for "${repoName}". Run "repo-expert setup" first.`);
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

// --- Program ---

const program = new Command();
program.name("repo-expert").description("Persistent AI agents for git repositories").version("0.1.0");

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
      const state = await loadState(STATE_FILE);
      const repoNames = Object.keys(state.agents);
      if (repoNames.length === 0) {
        console.error('No agents. Run "repo-expert setup" first.');
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
        console.error('No agents. Run "repo-expert setup" first.');
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
          console.log(`No previous sync for "${repoName}". Use --full for initial sync, or run setup.`);
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
  .action(async () => {
    const state = await loadState(STATE_FILE);
    const entries = Object.entries(state.agents);

    if (entries.length === 0) {
      console.log('No agents. Run "repo-expert setup" first.');
      return;
    }

    for (const [name, agent] of entries) {
      const files = Object.keys(agent.passages).length;
      const passages = Object.values(agent.passages).flat().length;
      const bootstrap = agent.lastBootstrap ? "yes" : "no";
      console.log(`  ${name}: agent=${agent.agentId} files=${files} passages=${passages} bootstrapped=${bootstrap}`);
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
      console.error('No agents. Run "repo-expert setup" first.');
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

program.parse();
