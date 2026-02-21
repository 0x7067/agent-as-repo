/**
 * One-off script: revert all agents to gpt-5.1 and fix persona blocks.
 * Run: pnpm tsx spikes/update-agents.ts
 */
import { Letta } from "@letta-ai/letta-client";
import { buildPersona } from "../src/core/prompts.js";
import * as yaml from "js-yaml";
import * as fs from "node:fs";

const MODEL = "chatgpt-plus-pro/gpt-5.1";

interface RepoConfig {
  description: string;
  tags?: string[];
}

interface Config {
  repos: Record<string, RepoConfig>;
}

const config = yaml.load(fs.readFileSync("config.yaml", "utf8")) as Config;

const STATE_PATH = ".repo-expert-state.json";
const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as {
  agents: Record<string, { agentId: string }>;
};

const client = new Letta({ apiKey: process.env.LETTA_API_KEY });

async function main() {
  for (const [repoName, agentState] of Object.entries(state.agents)) {
    const agentId = agentState.agentId;
    const repoConfig = config.repos[repoName];
    if (!repoConfig) {
      console.warn(`No config found for repo "${repoName}", skipping`);
      continue;
    }

    console.log(`\nUpdating ${repoName} (${agentId})...`);

    // 1. Update model
    await client.agents.update(agentId, { model: MODEL });
    console.log(`  model → ${MODEL}`);

    // 2. Build new persona
    const newPersona = buildPersona(repoName, repoConfig.description);

    // 3. Update persona block directly by label
    await client.agents.blocks.update("persona", { agent_id: agentId, value: newPersona });
    console.log(`  persona block updated`);
  }

  console.log("\nDone.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
