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

const DEFAULT_LLM_BASE_URL = "http://localhost:11434/v1";
const LLM_ENDPOINT_TIMEOUT_MS = 3000;

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

function isLocalUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/.test(url);
}

interface ProviderModelInfo {
  baseUrl: string;
  model: string | null;
  embeddingEngine: string | null;
  embeddingModel: string | null;
}

async function loadProviderModelInfo(configPath: string, fs: FileSystemPort = nodeFileSystem): Promise<ProviderModelInfo> {
  try {
    const { loadConfig } = await import("./config-loader.js");
    const config = await loadConfig(configPath, fs);
    return {
      baseUrl: config.provider.baseUrl,
      model: config.provider.model,
      embeddingEngine: config.provider.embeddingEngine,
      embeddingModel: config.provider.embeddingModel,
    };
  } catch {
    return { baseUrl: DEFAULT_LLM_BASE_URL, model: null, embeddingEngine: null, embeddingModel: null };
  }
}

/**
 * The LLM endpoint only needs an API key when it's remote (OpenRouter etc.).
 * Local Ollama needs none, so a missing key is only a warning for remote URLs.
 */
export function checkApiKey(baseUrl: string = DEFAULT_LLM_BASE_URL): CheckResult {
  if (isLocalUrl(baseUrl)) {
    return { name: "LLM API key", status: "pass", message: `Local LLM endpoint (${baseUrl}) needs no API key` };
  }
  if (!process.env["LLM_API_KEY"]) {
    const message = `LLM_API_KEY not set for non-local endpoint ${baseUrl}. Set it in .env if the endpoint requires auth.`;
    return { name: "LLM API key", status: "warn", message };
  }
  return { name: "LLM API key", status: "pass", message: "Set in environment" };
}

export async function checkApiConnection(provider: AgentProvider, agentId: string): Promise<CheckResult> {
  try {
    await provider.listPassages(agentId);
    return { name: "API connection", status: "pass", message: "Passage store is readable" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { name: "API connection", status: "fail", message: `Cannot read the passage store: ${msg}` };
  }
}

type ModelsFetchResult = { res: Response } | { error: string };

/** Shared `GET {baseUrl}/models` + timeout/abort plumbing for checkLlmEndpoint and checkModelAvailable. */
async function fetchModelsList(baseUrl: string, fetchImpl: typeof fetch): Promise<ModelsFetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => { controller.abort(); }, LLM_ENDPOINT_TIMEOUT_MS);
  try {
    return { res: await fetchImpl(`${baseUrl}/models`, { method: "GET", signal: controller.signal }) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function checkLlmEndpoint(
  baseUrl: string = DEFAULT_LLM_BASE_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckResult> {
  const result = await fetchModelsList(baseUrl, fetchImpl);
  // Warn (not fail): the endpoint may simply not be running yet (e.g. Ollama not started).
  if ("error" in result) {
    return { name: "LLM endpoint", status: "warn", message: `Cannot reach LLM endpoint ${baseUrl}: ${result.error}` };
  }
  if (result.res.ok) {
    return { name: "LLM endpoint", status: "pass", message: `Reachable at ${baseUrl}` };
  }
  return { name: "LLM endpoint", status: "warn", message: `${baseUrl}/models returned HTTP ${String(result.res.status)}` };
}

interface ModelsListResponse {
  data?: Array<{ id?: string }>;
}

/**
 * Verify `model` actually exists on the endpoint, not just that it responds.
 * A models-listing failure (unreachable, non-OK, or unimplemented `/models`)
 * degrades to a warning; only a confirmed absence from the list fails.
 */
export async function checkModelAvailable(
  baseUrl: string,
  model: string,
  label: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckResult> {
  const url = `${baseUrl}/models`;
  const result = await fetchModelsList(baseUrl, fetchImpl);
  if ("error" in result) {
    return { name: label, status: "warn", message: `Could not verify model "${model}" at ${url}: ${result.error}` };
  }
  if (!result.res.ok) {
    return { name: label, status: "warn", message: `${url} returned HTTP ${String(result.res.status)}; could not verify model "${model}" is available` };
  }

  let ids: string[];
  try {
    const payload = await result.res.json() as ModelsListResponse;
    ids = (payload.data ?? []).map((entry) => entry.id).filter((id): id is string => typeof id === "string");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { name: label, status: "warn", message: `Could not parse models list from ${url}: ${msg}` };
  }
  if (ids.length === 0) {
    return { name: label, status: "warn", message: `${url} returned no models; could not verify model "${model}" is available` };
  }
  if (ids.includes(model)) {
    return { name: label, status: "pass", message: `Model "${model}" is available at ${baseUrl}` };
  }
  return { name: label, status: "fail", message: `Model "${model}" not found at ${baseUrl}. Try: ollama pull ${model}` };
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
  const results: CheckResult[] = [];

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

  for (const name of stateAgents) {
    if (!configRepos.has(name)) {
      const message = `Agent "${name}" in state but not in config (orphaned)`;
      results.push({ name: "State consistency", status: "warn", message });
    }
  }

  for (const name of configRepos) {
    if (!stateAgents.has(name)) {
      const message = `Repo "${name}" in config but no agent created yet`;
      results.push({ name: "State consistency", status: "warn", message });
    }
  }

  if (provider?.agentExists) {
    for (const name of stateAgents) {
      const agent = stateAgentsMap[name];
      if (agent === undefined) continue;
      const exists = await provider.agentExists(agent.agentId);
      if (!exists) {
        const message =
          `Agent "${name}" (${agent.agentId}) is in state but missing from the store's agent registry — ` +
          `run "repo-expert setup" to self-heal.`;
        results.push({ name: "State consistency", status: "fail", message });
      }
    }
  }

  if (results.length === 0 && stateAgents.size > 0) {
    results.push({ name: "State consistency", status: "pass", message: "State matches config" });
  }

  return results;
}

export async function runAllChecks(
  provider: AgentProvider | null,
  configPath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const providerInfo = await loadProviderModelInfo(configPath);
  const baseUrl = providerInfo.baseUrl;

  results.push(checkApiKey(baseUrl), await checkLlmEndpoint(baseUrl, fetchImpl));

  if (providerInfo.model !== null) {
    results.push(await checkModelAvailable(baseUrl, providerInfo.model, "LLM model", fetchImpl));
  }
  if (providerInfo.embeddingEngine === "http" && providerInfo.embeddingModel !== null) {
    results.push(await checkModelAvailable(baseUrl, providerInfo.embeddingModel, "Embedding model", fetchImpl));
  }

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
        results.push(await checkApiConnection(provider, firstAgent.agentId));
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
