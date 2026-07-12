import os from "node:os";
import path from "node:path";
import type { CheckResult } from "../core/doctor.js";
import { createEmptyState } from "../core/state.js";
import { saveState } from "./state-store.js";
import type { AgentProvider } from "../ports/agent-provider.js";
import type { FileSystemPort } from "../ports/filesystem.js";
import type { GitPort } from "../ports/git.js";
import { nodeFileSystem } from "./adapters/node-filesystem.js";
import { nodeGit } from "./adapters/node-git.js";
import { embed } from "./llm-client.js";
import {
  checkApiConnection,
  checkApiKey,
  checkEmbeddingModelAvailable,
  checkLlmEndpoint,
  checkModelAvailable,
  loadProviderModelInfo,
  type ProviderModelInfo,
} from "./doctor-endpoint-checks.js";

// Re-exported so existing imports of these names from "./doctor.js" keep working
// unchanged — the LLM endpoint/model reachability checks themselves now live in
// doctor-endpoint-checks.ts (split out to keep this file under the line cap).
export {
  checkApiConnection,
  checkApiKey,
  checkEmbeddingModelAvailable,
  checkLlmEndpoint,
  checkModelAvailable,
  isLocalOllamaEndpoint,
  loadProviderModelInfo,
  type ProviderModelInfo,
} from "./doctor-endpoint-checks.js";

/**
 * The repo name + path config.example.yaml ships as its sample entry. Seeded
 * verbatim by `runDoctorFixes` when no config.yaml exists yet — flagged
 * distinctly from a "real" missing repo path so the next doctor run doesn't
 * just repeat a generic "does not exist" for a path nobody set on purpose.
 */
const PLACEHOLDER_REPO_NAME = "my-app";
const PLACEHOLDER_REPO_PATH = path.join(os.homedir(), "repos", "my-app");

function isPlaceholderRepoPath(name: string, resolvedPath: string): boolean {
  return name === PLACEHOLDER_REPO_NAME && resolvedPath === PLACEHOLDER_REPO_PATH;
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
      const message = isPlaceholderRepoPath(name, repo.path)
        ? `${repo.path} is a placeholder from config.example.yaml — edit repos.${name}.path to your real repo, or run "repo-expert init".`
        : `${repo.path} does not exist`;
      results.push({ name: `Repo "${name}"`, status: "fail", message });
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

/** Agents in state but absent from config: orphaned by a config edit that dropped the repo. */
function findOrphanedStateAgents(stateAgents: Set<string>, configRepos: Set<string>): CheckResult[] {
  const results: CheckResult[] = [];
  for (const name of stateAgents) {
    if (!configRepos.has(name)) {
      results.push({ name: "State consistency", status: "warn", message: `Agent "${name}" in state but not in config (orphaned)` });
    }
  }
  return results;
}

/** Repos in config with no agent created yet (setup never ran for them). */
function findUnsetupConfigRepos(configRepos: Set<string>, stateAgents: Set<string>): CheckResult[] {
  const results: CheckResult[] = [];
  for (const name of configRepos) {
    if (!stateAgents.has(name)) {
      results.push({ name: "State consistency", status: "warn", message: `Repo "${name}" in config but no agent created yet` });
    }
  }
  return results;
}

/** Confirms each state agent actually has a row in the store's agent registry (not just local state). */
async function findAgentsMissingFromStore(
  stateAgentsMap: Record<string, { agentId: string }>,
  agentExists: (agentId: string) => Promise<boolean>,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const [name, agent] of Object.entries(stateAgentsMap)) {
    const exists = await agentExists(agent.agentId);
    if (!exists) {
      const message =
        `Agent "${name}" (${agent.agentId}) is in state but missing from the store's agent registry — ` +
        `run "repo-expert setup" to self-heal.`;
      results.push({ name: "State consistency", status: "fail", message });
    }
  }
  return results;
}

/**
 * `configPath`/state comparison is purely local-file bookkeeping and always
 * ran; the store-registry check (`provider.agentExists`) is the part that
 * actually catches state-file/store drift (bug: doctor said "State matches
 * config" even when the store's `agents` table was empty). `provider` is
 * optional — when omitted (or when it doesn't implement `agentExists`) this
 * degrades to the old config/state-only comparison.
 */
export async function checkStateConsistency(
  configPath: string,
  provider: AgentProvider | null = null,
): Promise<CheckResult[]> {
  let configRepos: Set<string>;
  try {
    const { loadConfig } = await import("./config-loader.js");
    const config = await loadConfig(configPath);
    configRepos = new Set(Object.keys(config.repos));
  } catch {
    return [];
  }

  let stateAgentsMap: Record<string, { agentId: string }>;
  try {
    const { loadState } = await import("./state-store.js");
    const state = await loadState(".repo-expert-state.json");
    stateAgentsMap = state.agents;
  } catch {
    return [];
  }

  const stateAgents = new Set(Object.keys(stateAgentsMap));
  const results: CheckResult[] = [
    ...findOrphanedStateAgents(stateAgents, configRepos),
    ...findUnsetupConfigRepos(configRepos, stateAgents),
  ];

  if (provider?.agentExists) {
    // Invoke through the provider object: the port declares `this: void`, but
    // LocalProvider's method reads `this.store` — an unbound reference would
    // crash at runtime.
    const agentExists = (agentId: string): Promise<boolean> =>
      provider.agentExists?.(agentId) ?? Promise.resolve(false);
    results.push(...(await findAgentsMissingFromStore(stateAgentsMap, agentExists)));
  }

  if (results.length === 0 && stateAgents.size > 0) {
    results.push({ name: "State consistency", status: "pass", message: "State matches config" });
  }

  return results;
}

/** transformersjs runs in-process (no remote endpoint); http hits a real /embeddings probe. */
async function checkEmbeddingModelForProvider(
  providerInfo: ProviderModelInfo,
  baseUrl: string,
  embedImpl: typeof embed,
): Promise<CheckResult | null> {
  if (providerInfo.embeddingEngine === "transformersjs") {
    return {
      name: "Embedding model",
      status: "pass",
      message: `Using local transformers.js engine (model "${providerInfo.embeddingModel ?? "default"}"); no endpoint probe needed.`,
    };
  }
  if (providerInfo.embeddingEngine === "http" && providerInfo.embeddingModel !== null) {
    const apiKey = process.env["LLM_API_KEY"];
    return checkEmbeddingModelAvailable(baseUrl, providerInfo.embeddingModel, apiKey, "Embedding model", embedImpl);
  }
  return null;
}

/** First agent whose repo is still in config, preferring config order over state's insertion order. */
function findFirstConfiguredAgent(
  configRepoNames: string[],
  stateAgents: Record<string, { agentId: string }>,
): { agentId: string } | undefined {
  for (const repoName of configRepoNames) {
    if (Object.hasOwn(stateAgents, repoName)) {
      return stateAgents[repoName];
    }
  }
  return Object.values(stateAgents).at(0);
}

async function checkApiConnectionForConfiguredAgent(provider: AgentProvider, configPath: string): Promise<CheckResult> {
  try {
    const { loadState } = await import("./state-store.js");
    const { loadConfig } = await import("./config-loader.js");
    const state = await loadState(".repo-expert-state.json");
    const config = await loadConfig(configPath);
    const firstAgent = findFirstConfiguredAgent(Object.keys(config.repos), state.agents);
    if (firstAgent === undefined) {
      return { name: "API connection", status: "warn", message: "No agents yet — run setup to verify connection" };
    }
    return await checkApiConnection(provider, firstAgent.agentId);
  } catch {
    return { name: "API connection", status: "warn", message: "No state file — run setup to verify connection" };
  }
}

export async function runAllChecks(
  provider: AgentProvider | null,
  configPath: string,
  fetchImpl: typeof fetch = fetch,
  embedImpl: typeof embed = embed,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const providerInfo = await loadProviderModelInfo(configPath);
  const baseUrl = providerInfo.baseUrl;

  results.push(checkApiKey(baseUrl), await checkLlmEndpoint(baseUrl, fetchImpl));

  if (providerInfo.model !== null) {
    results.push(await checkModelAvailable(baseUrl, providerInfo.model, "LLM model", fetchImpl));
  }

  const embeddingCheck = await checkEmbeddingModelForProvider(providerInfo, baseUrl, embedImpl);
  if (embeddingCheck) results.push(embeddingCheck);

  if (provider) {
    results.push(await checkApiConnectionForConfiguredAgent(provider, configPath));
  }

  results.push(await checkConfigFile(configPath));

  const configExists = results.some((r) => r.name === "Config file" && r.status === "pass");
  if (configExists) {
    const [repoPathResults, stateConsistencyResults] = await Promise.all([
      checkRepoPaths(configPath),
      checkStateConsistency(configPath, provider),
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

const ENV_TEMPLATE = [
  "# Optional: Bearer token for a non-local LLM endpoint (e.g. OpenRouter). Local Ollama needs none.",
  "LLM_API_KEY=",
  "",
].join("\n");

export async function runDoctorFixes(
  configPath: string,
  cwd = process.cwd(),
  fs: FileSystemPort = nodeFileSystem,
): Promise<DoctorFixResult> {
  const applied: string[] = [];
  const suggestions: string[] = [];

  const envPath = path.resolve(cwd, ".env");
  try {
    await fs.access(envPath);
  } catch {
    await fs.writeFile(envPath, ENV_TEMPLATE);
    applied.push(`Created ${envPath} with LLM_API_KEY template.`);
  }

  try {
    await fs.access(configPath);
  } catch {
    const examplePath = path.resolve(cwd, "config.example.yaml");
    try {
      await fs.copyFile(examplePath, configPath);
      applied.push(`Copied ${examplePath} to ${configPath}.`);
      suggestions.push(`Edit ${configPath}: set repos.<name>.path to a real repo, or run "repo-expert init".`);
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
