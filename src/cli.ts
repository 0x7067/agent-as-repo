#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import Letta from "@letta-ai/letta-client";
import * as path from "path";
import { loadConfig } from "./shell/config-loader.js";
import { collectFiles } from "./shell/file-collector.js";
import { loadState, saveState } from "./shell/state-store.js";
import { createRepoAgent, loadPassages } from "./shell/agent-factory.js";
import { bootstrapAgent } from "./shell/bootstrap.js";
import { queryAgent } from "./shell/query.js";
import { LettaProvider } from "./shell/letta-provider.js";
import { chunkFile } from "./core/chunker.js";
import { addAgentToState, updatePassageMap } from "./core/state.js";
import { syncRepo } from "./shell/sync.js";
import { getAgentStatus } from "./shell/status.js";
import { execSync } from "child_process";

const STATE_FILE = ".repo-expert-state.json";

const program = new Command();
program.name("repo-expert").description("Persistent AI agents for git repositories").version("0.1.0");

program
  .command("setup")
  .description("Create agents from config.yaml")
  .option("--repo <name>", "Set up a single repo")
  .option("--config <path>", "Config file path", "config.yaml")
  .action(async (opts) => {
    const configPath = path.resolve(opts.config);
    const config = await loadConfig(configPath);
    const provider = new LettaProvider(new Letta());
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

      // Create agent
      const agentState = await createRepoAgent(provider, repoName, repoConfig, config.letta);
      console.log(`  Agent created: ${agentState.agentId}`);
      state = addAgentToState(state, repoName, agentState.agentId);

      // Collect and load files
      console.log(`  Collecting files from ${repoConfig.path}...`);
      const files = await collectFiles(repoConfig);
      console.log(`  Found ${files.length} files`);

      const chunks = files.flatMap((f) => chunkFile(f.path, f.content));
      console.log(`  Loading ${chunks.length} chunks...`);
      const passageMap = await loadPassages(provider, agentState.agentId, chunks);
      state = updatePassageMap(state, repoName, passageMap);
      console.log(`  Passages loaded`);

      // Bootstrap
      if (repoConfig.bootstrapOnCreate) {
        console.log(`  Bootstrapping...`);
        await bootstrapAgent(provider, agentState.agentId);
        state = {
          ...state,
          agents: {
            ...state.agents,
            [repoName]: { ...state.agents[repoName], lastBootstrap: new Date().toISOString() },
          },
        };
        console.log(`  Bootstrap complete`);
      }

      await saveState(STATE_FILE, state);
      console.log(`  Done: "${repoName}"`);
    }

    console.log("Setup complete.");
  });

program
  .command("ask <repo> <question>")
  .description("Ask an agent a question")
  .action(async (repo: string, question: string) => {
    const state = await loadState(STATE_FILE);
    const agentInfo = state.agents[repo];
    if (!agentInfo) {
      console.error(`No agent found for "${repo}". Run "repo-expert setup" first.`);
      process.exitCode = 1;
      return;
    }

    const provider = new LettaProvider(new Letta());
    const answer = await queryAgent(provider, agentInfo.agentId, question);
    console.log(answer);
  });

program
  .command("sync")
  .description("Sync file changes to agents")
  .option("--repo <name>", "Sync a single repo")
  .option("--full", "Full re-index instead of incremental")
  .option("--since <ref>", "Git ref to diff from (overrides stored commit)")
  .option("--config <path>", "Config file path", "config.yaml")
  .action(async (opts) => {
    const configPath = path.resolve(opts.config);
    const config = await loadConfig(configPath);
    const provider = new LettaProvider(new Letta());
    let state = await loadState(STATE_FILE);

    const repoNames = opts.repo ? [opts.repo] : Object.keys(state.agents);

    for (const repoName of repoNames) {
      const agentInfo = state.agents[repoName];
      if (!agentInfo) {
        console.error(`No agent found for "${repoName}". Run "repo-expert setup" first.`);
        process.exitCode = 1;
        return;
      }

      const repoConfig = config.repos[repoName];
      if (!repoConfig) {
        console.error(`Repo "${repoName}" not found in config`);
        process.exitCode = 1;
        return;
      }

      const headCommit = execSync("git rev-parse HEAD", { cwd: repoConfig.path, encoding: "utf-8" }).trim();

      let changedFiles: string[];
      if (opts.full) {
        // Full re-index: treat all files as changed
        const files = await collectFiles(repoConfig);
        changedFiles = files.map((f) => f.path);
        console.log(`Syncing "${repoName}" (full re-index, ${changedFiles.length} files)...`);
      } else {
        const sinceRef = opts.since ?? agentInfo.lastSyncCommit;
        if (!sinceRef) {
          console.log(`No previous sync for "${repoName}". Use --full for initial sync, or run setup.`);
          continue;
        }
        const diff = execSync(`git diff --name-only ${sinceRef}..HEAD`, {
          cwd: repoConfig.path,
          encoding: "utf-8",
        }).trim();
        changedFiles = diff ? diff.split("\n") : [];
        console.log(`Syncing "${repoName}" (${changedFiles.length} changed files since ${sinceRef.slice(0, 7)})...`);
      }

      if (changedFiles.length === 0) {
        console.log(`  No changes to sync.`);
        state = {
          ...state,
          agents: { ...state.agents, [repoName]: { ...agentInfo, lastSyncCommit: headCommit } },
        };
        await saveState(STATE_FILE, state);
        continue;
      }

      const result = await syncRepo({
        provider,
        agent: agentInfo,
        repoConfig,
        changedFiles,
        collectFile: async (filePath) => {
          const absPath = path.join(repoConfig.path, filePath);
          try {
            const fs = await import("fs/promises");
            const content = await fs.readFile(absPath, "utf-8");
            const stat = await fs.stat(absPath);
            return { path: filePath, content, sizeKb: stat.size / 1024 };
          } catch {
            return null; // File was deleted
          }
        },
        headCommit,
      });

      if (result.isFullReIndex) {
        console.log(`  Warning: ${changedFiles.length} files changed — consider --full re-index`);
      }

      console.log(`  Deleted: ${result.filesDeleted} files, Re-indexed: ${result.filesReIndexed} files`);

      state = {
        ...state,
        agents: {
          ...state.agents,
          [repoName]: { ...agentInfo, passages: result.passages, lastSyncCommit: result.lastSyncCommit },
        },
      };
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
      console.log("No agents. Run \"repo-expert setup\" first.");
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
  .action(async (opts) => {
    const state = await loadState(STATE_FILE);
    const provider = new LettaProvider(new Letta());
    const repoNames = opts.repo ? [opts.repo] : Object.keys(state.agents);

    for (const repoName of repoNames) {
      const agentInfo = state.agents[repoName];
      if (!agentInfo) {
        console.error(`No agent found for "${repoName}". Run "repo-expert setup" first.`);
        process.exitCode = 1;
        return;
      }

      const output = await getAgentStatus(provider, repoName, agentInfo);
      console.log(output);
    }
  });

program
  .command("destroy")
  .description("Delete all agents")
  .option("--repo <name>", "Destroy a single repo agent")
  .action(async (opts) => {
    const state = await loadState(STATE_FILE);
    const provider = new LettaProvider(new Letta());
    const repoNames = opts.repo ? [opts.repo] : Object.keys(state.agents);

    for (const repoName of repoNames) {
      const agentInfo = state.agents[repoName];
      if (!agentInfo) {
        console.log(`No agent for "${repoName}", skipping`);
        continue;
      }
      console.log(`Deleting agent for "${repoName}" (${agentInfo.agentId})...`);
      try {
        await provider.deleteAgent(agentInfo.agentId);
      } catch {
        console.warn(`  Warning: could not delete agent ${agentInfo.agentId} from Letta`);
      }
    }

    // Rebuild state without deleted agents
    let newState = state;
    for (const repoName of repoNames) {
      const { [repoName]: _, ...rest } = newState.agents;
      newState = { ...newState, agents: rest };
    }
    await saveState(STATE_FILE, newState);
    console.log("Done.");
  });

program.parse();
