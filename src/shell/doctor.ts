import * as fs from "fs/promises";
import { execFileSync } from "child_process";
import type { CheckResult } from "../core/doctor.js";
import type { AgentProvider } from "./provider.js";

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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: "API connection", status: "fail", message: `Cannot reach Letta API: ${msg}` };
  }
}

export async function checkConfigFile(configPath: string): Promise<CheckResult> {
  try {
    await fs.access(configPath);
    return { name: "Config file", status: "pass", message: `${configPath} found` };
  } catch {
    return { name: "Config file", status: "fail", message: `${configPath} not found. Run "repo-expert init" to create it.` };
  }
}

export async function checkRepoPaths(configPath: string): Promise<CheckResult[]> {
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
      if (!stat.isDirectory()) {
        results.push({ name: `Repo "${name}"`, status: "fail", message: `${repo.path} is not a directory` });
      } else {
        results.push({ name: `Repo "${name}"`, status: "pass", message: repo.path });
      }
    } catch {
      results.push({ name: `Repo "${name}"`, status: "fail", message: `${repo.path} does not exist` });
    }
  }

  return results;
}

export function checkGit(): CheckResult {
  try {
    const version = execFileSync("git", ["--version"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
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

  // Connection check: use first agent in state as a ping target
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
