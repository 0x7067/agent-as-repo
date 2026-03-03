import path from "node:path";
import type { CheckResult } from "../core/doctor.js";
import { createEmptyState } from "../core/state.js";
import { saveState } from "./state-store.js";
import type { AgentProvider } from "./provider.js";
import type { FileSystemPort } from "../ports/filesystem.js";
import type { GitPort } from "../ports/git.js";
import { nodeFileSystem } from "./adapters/node-filesystem.js";
import { nodeGit } from "./adapters/node-git.js";

type ProviderType = "letta" | "viking";

function expectedApiKeyEnv(providerType: ProviderType): "LETTA_API_KEY" | "OPENROUTER_API_KEY" {
  return providerType === "viking" ? "OPENROUTER_API_KEY" : "LETTA_API_KEY";
}

async function detectProviderType(configPath: string, fs: FileSystemPort = nodeFileSystem): Promise<ProviderType> {
  try {
    const { loadConfig } = await import("./config-loader.js");
    const config = await loadConfig(configPath, fs);
    return config.provider.type;
  } catch {
    return "letta";
  }
}

export function checkApiKey(providerType: ProviderType = "letta"): CheckResult {
  const envName = expectedApiKeyEnv(providerType);
  if (!process.env[envName]) {
    return { name: "API key", status: "fail", message: `${envName} not set. Add it to .env or your environment.` };
  }
  return { name: "API key", status: "pass", message: "Set in environment" };
}

export async function checkApiConnection(
  provider: AgentProvider,
  agentId: string,
  providerType: ProviderType = "letta",
): Promise<CheckResult> {
  try {
    await provider.listPassages(agentId);
    return {
      name: "API connection",
      status: "pass",
      message: providerType === "viking" ? "Connected to OpenViking/OpenRouter runtime" : "Connected to Letta Cloud",
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      name: "API connection",
      status: "fail",
      message: providerType === "viking" ? `Cannot reach Viking/OpenRouter runtime: ${msg}` : `Cannot reach Letta API: ${msg}`,
    };
  }
}

export async function checkConfigFile(configPath: string, fs: FileSystemPort = nodeFileSystem): Promise<CheckResult> {
  try {
    await fs.access(configPath);
    return { name: "Config file", status: "pass", message: `${configPath} found` };
  } catch {
    return { name: "Config file", status: "fail", message: `${configPath} not found. Run "repo-expert init" to create it.` };
  }
}

export async function checkRepoPaths(configPath: string, fs: FileSystemPort = nodeFileSystem): Promise<CheckResult[]> {
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
      if (stat.isDirectory()) {
        results.push({ name: `Repo "${name}"`, status: "pass", message: repo.path });
      } else {
        results.push({ name: `Repo "${name}"`, status: "fail", message: `${repo.path} is not a directory` });
      }
    } catch {
      results.push({ name: `Repo "${name}"`, status: "fail", message: `${repo.path} does not exist` });
    }
  }

  return results;
}

export function checkGit(git: GitPort = nodeGit): CheckResult {
  try {
    const version = git.version();
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
  const providerType = await detectProviderType(configPath);

  results.push(checkApiKey(providerType));

  if (provider) {
    try {
      const { loadState } = await import("./state-store.js");
      const { loadConfig } = await import("./config-loader.js");
      const state = await loadState(".repo-expert-state.json");
      const config = await loadConfig(configPath);
      let configuredAgent: (typeof state.agents)[string] | undefined;
      for (const repoName of Object.keys(config.repos)) {
        if (Object.hasOwn(state.agents, repoName)) {
          configuredAgent = state.agents[repoName];
          break;
        }
      }
      const firstAgent = configuredAgent ?? Object.values(state.agents).at(0);
      if (firstAgent === undefined) {
        results.push({ name: "API connection", status: "warn", message: "No agents yet — run setup to verify connection" });
      } else {
        results.push(await checkApiConnection(provider, firstAgent.agentId, providerType));
      }
    } catch {
      results.push({ name: "API connection", status: "warn", message: "No state file — run setup to verify connection" });
    }
  }

  results.push(await checkConfigFile(configPath));

  const configExists = results.some((r) => r.name === "Config file" && r.status === "pass");
  if (configExists) {
    const [repoPathResults, stateConsistencyResults] = await Promise.all([
      checkRepoPaths(configPath),
      checkStateConsistency(configPath),
    ]);
    results.push(...repoPathResults, ...stateConsistencyResults);
  }

  results.push(checkGit());

  return results;
}

export interface DoctorFixResult {
  applied: string[];
  suggestions: string[];
}

export async function runDoctorFixes(
  configPath: string,
  cwd = process.cwd(),
  fs: FileSystemPort = nodeFileSystem,
): Promise<DoctorFixResult> {
  const applied: string[] = [];
  const suggestions: string[] = [];
  const providerType = await detectProviderType(configPath, fs);
  const envName = expectedApiKeyEnv(providerType);

  const envPath = path.resolve(cwd, ".env");
  try {
    await fs.access(envPath);
  } catch {
    await fs.writeFile(envPath, `${envName}=your-key-here\n`);
    applied.push(`Created ${envPath} with ${envName} template.`);
  }

  try {
    await fs.access(configPath);
  } catch {
    const examplePath = path.resolve(cwd, "config.example.yaml");
    try {
      await fs.copyFile(examplePath, configPath);
      applied.push(`Copied ${examplePath} to ${configPath}.`);
    } catch {
      suggestions.push(`Create ${configPath} manually or run "repo-expert init".`);
    }
  }

  const statePath = path.resolve(cwd, ".repo-expert-state.json");
  try {
    await fs.access(statePath);
  } catch {
    await saveState(statePath, createEmptyState(), fs);
    applied.push(`Created empty state file at ${statePath}.`);
  }

  if (applied.length === 0) {
    suggestions.push("No automatic fixes were needed.");
  }

  return { applied, suggestions };
}
