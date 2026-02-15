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
