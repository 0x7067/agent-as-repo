#!/usr/bin/env node
/* eslint-disable max-lines */
import "dotenv/config";
import { Command } from "commander";
import path from "node:path";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { loadConfig } from "./shell/config-loader.js";
import { runInit } from "./shell/init.js";
import { checkLlmEndpoint, checkModelAvailable, runAllChecks, runDoctorFixes } from "./shell/doctor.js";
import { formatSelfChecks, runSelfChecks } from "./shell/self-check.js";
import { completionFileName, generateCompletionScript, type CompletionShell } from "./core/completion.js";
import { computeDoctorExitCode, formatDoctorReport } from "./core/doctor.js";
import { ConfigError, formatConfigError } from "./core/config.js";
import { collectFiles } from "./shell/file-collector.js";
import { StateFileError, loadState, saveState } from "./shell/state-store.js";
import { createRepoAgent, loadPassages } from "./shell/agent-factory.js";
import { bootstrapAgent } from "./shell/bootstrap.js";
import type { AgentProvider, CreateAgentParams, SendMessageOptions } from "./ports/agent-provider.js";
import { LocalProvider } from "./shell/local-provider.js";
import { createRepoAccess } from "./shell/repo-tools.js";
import { SqlitePassageStore } from "./shell/sqlite-store.js";
import { SqliteBlockStorage } from "./shell/sqlite-block-storage.js";
import { resolveStoreDbPath } from "./shell/repo-expert-paths.js";
import { createEmbedder } from "./shell/embedder-factory.js";
import { selectChunkingStrategy } from "./core/chunker.js";
import { hashFileContent } from "./core/content-hash.js";
import { initTreeSitterChunker } from "./core/tree-sitter-chunker.js";
import { repoFilterOptions, shouldIncludeFile } from "./core/filter.js";
import { partitionDiffPaths } from "./core/submodule.js";
import { listSubmodules, expandSubmoduleFiles } from "./shell/submodule-collector.js";
import { addAgentToState, removeAgentFromState, updateAgentField, updatePassageMap } from "./core/state.js";
import { syncRepo } from "./shell/sync.js";
import { consolidateAgentMemory } from "./shell/consolidate.js";
import { shouldConsolidate, shouldSkipConsolidation } from "./core/consolidate.js";
import { nodeGit } from "./shell/adapters/node-git.js";
import { formatGitEvidence, formatOrphanedCheckpointMessage, OrphanedCheckpointError, type EvidenceSource } from "./core/git-evidence.js";
import { gatherGitEvidence, GIT_EVIDENCE_MAX_CHARS } from "./shell/git-evidence.js";
import { resolveTreeSitterWasmPaths } from "./shell/tree-sitter-paths.js";
import { getAgentStatus, getAgentStatusData } from "./shell/status.js";
import { exportAgent } from "./shell/export.js";
import { onboardAgent } from "./shell/onboard.js";
import { installInstructions } from "./shell/agent-instructions.js";
import { BROADCAST_ASK_DEFAULT_TIMEOUT_MS, broadcastAsk } from "./shell/group-provider.js";
import { watchRepos } from "./shell/watch.js";
import { withTimeoutSignal } from "./shell/with-timeout.js";
import { readPackageVersion } from "./shell/package-version.js";
import { isMainModule } from "./shell/is-main-module.js";
import { DEFAULT_WATCH_CONFIG } from "./core/watch.js";
import { generatePlist, PLIST_LABEL } from "./core/daemon.js";
import { generateMcpEntry, checkMcpEntry, resolveMcpLaunchSpec, type McpLaunchSpec, type McpProviderConfig } from "./core/mcp-config.js";
import { buildPostSetupNextSteps, getSetupMode } from "./core/setup.js";
import { MAX_FILE_SIZE_KB, MEMORY_BLOCK_LIMIT, type AgentState, type AppState, type Config, type RepoConfig } from "./core/types.js";
import { reconcileAgent, fixReconcileDrift, type ReconcileResult } from "./shell/reconcile.js";
import type { LocalRuntimeOptions } from "./shell/local-provider.js";

interface SetupOpts {
  repo?: string;
  config: string;
  resume?: boolean;
  reindex?: boolean;
  bootstrap: boolean;
  json?: boolean;
  loadRetries: string;
  bootstrapRetries: string;
  loadTimeoutMs: string;
  bootstrapTimeoutMs: string;
  skipPreflight?: boolean;
}

interface ProgramOpts {
  noInput?: boolean;
  debug?: boolean;
}

interface InitOpts {
  apiKey?: string;
  repoPath?: string;
  model?: string;
  baseUrl?: string;
  embeddingEngine?: string;
  yes?: boolean;
}

interface DoctorOpts {
  config: string;
  json?: boolean;
  fix?: boolean;
  strict?: boolean;
}

interface SelfCheckOpts {
  json?: boolean;
}

interface AskOpts {
  all?: boolean;
  timeout: string;
  fast?: boolean;
  fastModel?: string;
  askTimeoutMs?: string;
  maxSteps?: string;
  config?: string;
}

interface SyncOpts {
  repo?: string;
  full?: boolean;
  since?: string;
  config: string;
  json?: boolean;
  dryRun?: boolean;
}

interface RepoOpts {
  repo?: string;
  json?: boolean;
}

interface OnboardOpts {
  timeoutMs?: string;
}

interface ConsolidateCliOpts {
  repo?: string;
  config: string;
}

interface DestroyOpts {
  repo?: string;
  force?: boolean;
  dryRun?: boolean;
}

interface WatchOpts {
  repo?: string;
  interval: string;
  debounce: string;
  config: string;
}

interface InstallDaemonOpts {
  interval: string;
  debounce: string;
  config: string;
}

interface ConfigLintOpts {
  config: string;
  json?: boolean;
}

interface ListOpts {
  json?: boolean;
  live?: boolean;
}

interface ReconcileOpts {
  repo?: string;
  fix?: boolean;
  json?: boolean;
  verbose?: boolean;
}

const STATE_FILE = ".repo-expert-state.json";

interface AskRuntimeSettings {
  fastModel?: string;
  askTimeoutMs: number;
  maxSteps?: number;
  useFast: boolean;
}

// --- Helpers ---

class CliUserError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliUserError";
    this.exitCode = exitCode;
  }
}

function createProvider(config: Config): AgentProvider {
  const llmApiKey = process.env["LLM_API_KEY"];
  const dbPath = resolveStoreDbPath();
  const store = new SqlitePassageStore({
    dbPath,
    embed: createEmbedder({
      engine: config.provider.embeddingEngine,
      model: config.provider.embeddingModel,
      baseUrl: config.provider.baseUrl,
      ...(llmApiKey === undefined ? {} : { apiKey: llmApiKey }),
    }),
  });
  const blockStorage = new SqliteBlockStorage(dbPath);
  return new LocalProvider(
    store,
    config.provider.model,
    blockStorage,
    {
      baseUrl: config.provider.baseUrl,
      fallbackModels: config.provider.fallbackModels,
      repoAccess: createRepoAccess(config.repos),
      ...(llmApiKey === undefined ? {} : { apiKey: llmApiKey }),
      ...getRuntimeOptionsFromEnv(),
    },
  );
}

class FakeProvider implements AgentProvider {
  private nextAgentId = 1;
  private nextPassageId = 1;
  private passagesByAgent: Record<string, { id: string; text: string }[]> = {};
  private blocksByAgent: Record<string, Record<string, { value: string; limit: number }>> = {};

  createAgent(_params: CreateAgentParams): Promise<{ agentId: string }> {
    const agentId = `fake-agent-${String(this.nextAgentId++)}`;
    this.passagesByAgent[agentId] = [];
    this.blocksByAgent[agentId] = {
      persona: { value: "fake", limit: 5000 },
      architecture: { value: "fake", limit: 5000 },
      conventions: { value: "fake", limit: 5000 },
    };
    return Promise.resolve({ agentId });
  }

  deleteAgent(agentId: string): Promise<void> {
    this.passagesByAgent = Object.fromEntries(
      Object.entries(this.passagesByAgent).filter(([existingAgentId]) => existingAgentId !== agentId),
    );
    this.blocksByAgent = Object.fromEntries(
      Object.entries(this.blocksByAgent).filter(([existingAgentId]) => existingAgentId !== agentId),
    );
    return Promise.resolve();
  }

  async storePassage(agentId: string, text: string): Promise<string> {
    const delayMs = Number.parseInt(process.env["REPO_EXPERT_TEST_DELAY_STORE_MS"] ?? "0", 10);
    if (!Number.isNaN(delayMs) && delayMs > 0) {
      await delay(delayMs);
    }
    if (process.env["REPO_EXPERT_TEST_FAIL_LOAD_ONCE"] === "1") {
      process.env["REPO_EXPERT_TEST_FAIL_LOAD_ONCE"] = "0";
      throw new Error("simulated load failure");
    }
    if (!Object.hasOwn(this.passagesByAgent, agentId)) this.passagesByAgent[agentId] = [];
    const passages = getOwnRecordValue(this.passagesByAgent, agentId);
    if (passages === undefined) {
      throw new Error(`Missing passage store for fake agent ${agentId}`);
    }
    const id = `fake-passage-${String(this.nextPassageId++)}`;
    passages.push({ id, text });
    return id;
  }

  deletePassage(agentId: string, passageId: string): Promise<void> {
    const list = this.passagesByAgent[agentId] ?? [];
    this.passagesByAgent[agentId] = list.filter((p) => p.id !== passageId);
    return Promise.resolve();
  }

  listPassages(agentId: string): Promise<Array<{ id: string; text: string }>> {
    return Promise.resolve(this.passagesByAgent[agentId] ?? []);
  }

  getBlock(agentId: string, label: string): Promise<{ value: string; limit: number }> {
    const blocks = getOwnRecordValue(this.blocksByAgent, agentId);
    if (blocks === undefined) {
      return Promise.resolve({ value: "", limit: 5000 });
    }
    const block = getOwnRecordValue(blocks, label);
    if (block === undefined) {
      return Promise.resolve({ value: "", limit: 5000 });
    }
    return Promise.resolve(block);
  }

  updateBlock(agentId: string, label: string, value: string): Promise<{ value: string; limit: number }> {
    if (!Object.hasOwn(this.blocksByAgent, agentId)) this.blocksByAgent[agentId] = {};
    const blocks = getOwnRecordValue(this.blocksByAgent, agentId);
    if (blocks === undefined) {
      throw new Error(`Missing block store for fake agent ${agentId}`);
    }
    const existingBlock = getOwnRecordValue(blocks, label);
    const limit = existingBlock === undefined ? 5000 : existingBlock.limit;
    blocks[label] = { value, limit };
    return Promise.resolve({ value, limit });
  }

  async sendMessage(_agentId: string, _content: string, options?: SendMessageOptions): Promise<string> {
    const delayMs = Number.parseInt(process.env["REPO_EXPERT_TEST_DELAY_BOOTSTRAP_MS"] ?? "0", 10);
    if (!Number.isNaN(delayMs) && delayMs > 0) {
      await delay(delayMs);
    }
    if (process.env["REPO_EXPERT_TEST_FAIL_BOOTSTRAP_ONCE"] === "1") {
      process.env["REPO_EXPERT_TEST_FAIL_BOOTSTRAP_ONCE"] = "0";
      throw new Error("simulated bootstrap failure");
    }
    if (process.env["REPO_EXPERT_TEST_ECHO_MODEL"] === "1") {
      return `model=${options?.overrideModel ?? "default"}`;
    }
    return "ok";
  }

  async consolidateMemory(agentId: string, prompt: string, _options?: unknown): Promise<void> {
    if (process.env["REPO_EXPERT_TEST_FAIL_CONSOLIDATE_ONCE"] === "1") {
      process.env["REPO_EXPERT_TEST_FAIL_CONSOLIDATE_ONCE"] = "0";
      throw new Error("simulated consolidation failure");
    }
    if (process.env["REPO_EXPERT_TEST_ECHO_PROMPT"] === "1") {
      console.log(`[fake-consolidate-prompt]${prompt}[/fake-consolidate-prompt]`);
    }
    await this.updateBlock(agentId, "architecture", "consolidated architecture");
    await this.updateBlock(agentId, "conventions", "consolidated conventions");
  }
}

function createProviderForCommands(config: Config | null): AgentProvider {
  if (process.env["REPO_EXPERT_TEST_FAKE_PROVIDER"] === "1") {
    return new FakeProvider();
  }
  if (!config) {
    throw new CliUserError('Config required. Run "repo-expert init" or ensure config.yaml exists.');
  }
  return createProvider(config);
}

interface SetupPreflightResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Fail fast, before any indexing work: confirm the configured LLM endpoint is
 * reachable and that the chat/embedding models it names actually exist there.
 * Reuses the same doctor.ts checks `repo-expert doctor` runs, so the verdict
 * is consistent between the two commands. A models-endpoint-unavailable
 * result degrades to a warning (some proxies don't implement `/models`), but
 * an unreachable endpoint or a confirmed-missing model blocks setup.
 */
async function runSetupPreflight(config: Config): Promise<SetupPreflightResult> {
  const baseUrl = config.provider.baseUrl;
  const errors: string[] = [];
  const warnings: string[] = [];

  const endpointResult = await checkLlmEndpoint(baseUrl);
  if (endpointResult.status !== "pass") {
    errors.push(`LLM endpoint unreachable at ${baseUrl} — is Ollama running? Try: ollama serve`);
    return { ok: false, errors, warnings };
  }

  const modelResult = await checkModelAvailable(baseUrl, config.provider.model, "LLM model");
  if (modelResult.status === "fail") {
    errors.push(`Model "${config.provider.model}" not found at ${baseUrl} — try: ollama pull ${config.provider.model}`);
  } else if (modelResult.status === "warn") {
    warnings.push(modelResult.message);
  }

  if (config.provider.embeddingEngine === "http") {
    const embeddingModel = config.provider.embeddingModel;
    const embeddingResult = await checkModelAvailable(baseUrl, embeddingModel, "Embedding model");
    if (embeddingResult.status === "fail") {
      errors.push(`Embedding model "${embeddingModel}" not found at ${baseUrl} — try: ollama pull ${embeddingModel}`);
    } else if (embeddingResult.status === "warn") {
      warnings.push(embeddingResult.message);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

async function loadConfigForProvider(configPath: string): Promise<Config | null> {
  // The fake provider stands in for the LLM regardless of config, but git-backed
  // commands (consolidate, sync's downstream helpers) still need real repo config
  // to exercise their git wiring under test. Fall back to null only when no config
  // file is present, same as loadOptionalConfig elsewhere.
  if (process.env["REPO_EXPERT_TEST_FAKE_PROVIDER"] === "1") return loadOptionalConfig(configPath);
  return loadConfigSafe(configPath);
}

async function loadConfigSafe(configPath: string): Promise<Config> {
  try {
    return await loadConfig(configPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CliUserError(`Config file not found: ${configPath}\nRun "repo-expert init" or copy config.example.yaml to config.yaml.`);
    }
    if (error instanceof ConfigError) {
      throw new CliUserError(formatConfigError(error));
    }
    throw error;
  }
}

async function prepareChunking(): Promise<ReturnType<typeof selectChunkingStrategy>> {
  await initTreeSitterChunker(resolveTreeSitterWasmPaths());
  return selectChunkingStrategy("tree-sitter");
}

function resolveMcpProviderConfig(config: Config | null): { providerConfig: McpProviderConfig; warnings: string[] } {
  const warnings: string[] = [];
  const model = config?.provider.model ?? process.env["LLM_MODEL"];
  const baseUrl = config?.provider.baseUrl ?? process.env["LLM_BASE_URL"];
  const embeddingModel = config?.provider.embeddingModel ?? process.env["LLM_EMBEDDING_MODEL"];
  const embeddingEngine = config?.provider.embeddingEngine ?? process.env["LLM_EMBEDDING_ENGINE"];
  const llmApiKey = process.env["LLM_API_KEY"];

  if (config === null) {
    warnings.push("config.yaml not found; MCP entry uses env/default values for model and URLs.");
  }

  return {
    providerConfig: {
      ...(model === undefined ? {} : { model }),
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(embeddingModel === undefined ? {} : { embeddingModel }),
      ...(embeddingEngine === undefined ? {} : { embeddingEngine }),
      ...(llmApiKey === undefined ? {} : { llmApiKey }),
    },
    warnings,
  };
}

async function loadOptionalConfig(configPath: string): Promise<Config | null> {
  try {
    return await loadConfig(configPath);
  } catch {
    return null;
  }
}

/**
 * Apply the same extension/ignore-dir filtering and submodule expansion to a
 * raw list of diff paths, regardless of which evidence source produced them
 * (an explicit --since ref or a validated checkpoint commit).
 */
async function filterChangedFiles(diffPaths: string[], repoConfig: RepoConfig): Promise<string[]> {
  if (repoConfig.includeSubmodules) {
    const submodules = listSubmodules(repoConfig.path);
    const { changedSubmodules, regularFiles } = partitionDiffPaths(
      diffPaths,
      submodules,
      (f) => shouldIncludeFile(f, 0, repoFilterOptions(repoConfig)),
    );
    const expandedSubFiles: string[] = [];
    for (const sub of changedSubmodules) {
      expandedSubFiles.push(...(await expandSubmoduleFiles(repoConfig, sub)));
    }
    return [...regularFiles, ...expandedSubFiles];
  }
  return diffPaths.filter((f) => shouldIncludeFile(f, 0, repoFilterOptions(repoConfig)));
}

/**
 * Run (or skip) manual consolidation for a single repo agent, returning the
 * possibly-updated app state. Extracted from the `consolidate` command action
 * to keep its cognitive complexity within budget.
 */
async function consolidateRepoAgent(params: {
  state: AppState;
  repoName: string;
  agentInfo: AgentState;
  config: Config | null;
  provider: AgentProvider;
}): Promise<AppState> {
  const { repoName, agentInfo, config, provider } = params;
  let state = params.state;

  console.log(`Consolidating memory for "${repoName}"...`);
  const repoConfig = config ? getOwnRecordValue(config.repos, repoName) : undefined;
  const headCommit = repoConfig ? nodeGit.headCommit(repoConfig.path) : null;

  if (shouldSkipConsolidation(agentInfo, headCommit)) {
    console.log(`  Skipped: no repository changes since last consolidation.`);
    return state;
  }

  let gitEvidence = "";
  if (repoConfig) {
    try {
      gitEvidence = gatherGitEvidence(nodeGit, repoConfig.path, agentInfo);
    } catch (error) {
      if (error instanceof OrphanedCheckpointError) {
        console.error(
          `"${repoName}": checkpoint commit ${error.commit.slice(0, 7)} no longer exists (rebase, force-push, or gc?). ` +
          `Re-establish it with "repo-expert sync --since <ref>" or "repo-expert sync --full", then consolidate.`,
        );
        process.exitCode = 1;
        return state;
      }
      throw error;
    }
  }
  const result = await consolidateAgentMemory({
    provider,
    agentId: agentInfo.agentId,
    changedFiles: [],
    syncResult: { filesReIndexed: 0, filesRemoved: 0 },
    blockCharLimit: MEMORY_BLOCK_LIMIT,
    gitEvidence,
    log: (line: string) => { console.log(line); },
  });

  if (!result.consolidated) {
    console.log(`  Skipped: ${result.error ?? "nothing to consolidate"}.`);
    return state;
  }

  if (result.changed) {
    if (headCommit !== null) {
      state = updateAgentField(state, repoName, { lastConsolidatedCommit: headCommit });
      await saveState(STATE_FILE, state);
    }
    console.log(`  Done.`);
  }
  // else: "consolidation: blocks unchanged" was already logged inside consolidateAgentMemory.

  return state;
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function whichAll(binary: string): string[] {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- which must be resolved from PATH
    const output = execFileSync("which", ["-a", binary], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return output ? output.split("\n").map((line) => line.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    const fs = await import("node:fs/promises");
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveNodeExecutable(): Promise<string | null> {
  const candidates = uniqueNonEmpty([process.execPath, ...whichAll("node")]);
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function requireAgent(state: AppState, repoName: string): AgentState | null {
  const agent = getOwnRecordValue(state.agents, repoName);
  if (agent === undefined) {
    if (Object.keys(state.agents).length === 0) {
      console.error(`No agents found. Run "repo-expert setup" to create them.`);
    } else {
      console.error(`No agent found for "${repoName}". Available: ${Object.keys(state.agents).join(", ")}`);
    }
    process.exitCode = 1;
    return null;
  }
  return agent;
}

function getOwnRecordValue<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

async function confirmDestroy(existing: string[]): Promise<boolean> {
  if (noInputEnabled()) {
    console.error("destroy requires confirmation. Use --force with --no-input for non-interactive runs.");
    process.exitCode = 1;
    return false;
  }
  if (!interactiveInputAvailable()) {
    console.error("destroy requires an interactive terminal for confirmation. Use --force in non-interactive environments.");
    process.exitCode = 1;
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await question(rl, `Delete ${String(existing.length)} agent(s) (${existing.join(", ")})? [y/N] `);
  rl.close();
  if (answer.trim().toLowerCase() !== "y") {
    console.log("Aborted.");
    return false;
  }
  return true;
}

async function destroyAgents(
  provider: AgentProvider,
  state: AppState,
  existing: string[],
): Promise<void> {
  for (const repoName of existing) {
    const agentInfo = getOwnRecordValue(state.agents, repoName);
    if (agentInfo === undefined) {
      continue;
    }
    console.log(`Deleting agent for "${repoName}" (${agentInfo.agentId})...`);
    try {
      await provider.deleteAgent(agentInfo.agentId);
    } catch {
      console.warn(`  Warning: could not delete agent ${agentInfo.agentId} from the provider`);
    }
  }
}

function isValidEmbeddingEngine(value: string): value is "http" | "transformersjs" {
  return value === "http" || value === "transformersjs";
}

function parseIntOrDefault(value: string, fallback: number): number {
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

function parseNonNegativeInt(value: string, fallback: number): number {
  const parsed = parseIntOrDefault(value, fallback);
  return parsed < 0 ? fallback : parsed;
}

function parseOptionalPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseOptionalMaxSteps(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function getRuntimeOptionsFromEnv(): LocalRuntimeOptions {
  const requestTimeoutMs = parseOptionalPositiveInt(process.env["LLM_REQUEST_TIMEOUT_MS"], 20_000);
  const maxRetriesPerModel = parseNonNegativeInt(process.env["LLM_MAX_RETRIES_PER_MODEL"] ?? "1", 1);
  const retryBaseDelayMs = parseOptionalPositiveInt(process.env["LLM_RETRY_BASE_DELAY_MS"], 600);
  return { requestTimeoutMs, maxRetriesPerModel, retryBaseDelayMs };
}

function formatDurationMs(durationMs: number): string {
  if (durationMs < 1000) return `${String(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(2)}s`;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(label: string, timeoutMs: number, fn: () => Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => { reject(new Error(`${label} timed out after ${String(timeoutMs)}ms`)); }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function withRetry<T>(
  label: string,
  retries: number,
  fn: (attempt: number) => Promise<T>,
  onRetry: (message: string) => void = (message) => { console.warn(message); },
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastErr = error;
      if (attempt === retries) break;
      const waitMs = 500 * Math.pow(2, attempt);
      onRetry(
        `  ${label} failed (attempt ${String(attempt + 1)}/${String(retries + 1)}): ${(error as Error).message}. Retrying in ${String(waitMs)}ms...`,
      );
      await delay(waitMs);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function printProgress(loaded: number, total: number): void {
  process.stdout.write(`\r  Loading passages: ${String(loaded)}/${String(total)}`);
}

function noInputEnabled(): boolean {
  return process.argv.includes("--no-input") || program.opts<ProgramOpts>().noInput === true;
}

function interactiveInputAvailable(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}

function readDebugEnabled(argv: string[]): boolean {
  return argv.includes("--debug");
}

function question(rl: ReadlineInterface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

const ASK_DEFAULT_TIMEOUT_MS = 60_000;
/** Onboarding walks the full memory + archival search, so it gets a longer budget than `ask` (consistent with setup's bootstrap-timeout-ms default). */
const ONBOARD_DEFAULT_TIMEOUT_MS = 120_000;

async function loadAskConfigDefaults(configPath: string | undefined): Promise<{
  askTimeoutMs: number;
  fastModel?: string;
}> {
  const defaults = { askTimeoutMs: ASK_DEFAULT_TIMEOUT_MS };

  const resolvedPath = configPath ? path.resolve(configPath) : path.resolve("config.yaml");
  if (!configPath) {
    try {
      const fs = await import("node:fs/promises");
      await fs.access(resolvedPath);
    } catch {
      return defaults;
    }
  }

  const config = await loadConfigSafe(resolvedPath);
  return {
    askTimeoutMs: defaults.askTimeoutMs,
    ...(config.provider.fastModel === undefined ? {} : { fastModel: config.provider.fastModel }),
  };
}

async function askAgent(
  provider: AgentProvider,
  agent: AgentState,
  question: string,
  settings: AskRuntimeSettings,
): Promise<string> {
  const overrideModel = settings.useFast ? settings.fastModel : undefined;
  const sendOptions = {
    ...(overrideModel === undefined ? {} : { overrideModel }),
    ...(settings.maxSteps === undefined ? {} : { maxSteps: settings.maxSteps }),
  };
  return withTimeoutSignal(
    `Ask "${agent.repoName}"`,
    settings.askTimeoutMs,
    (signal) => provider.sendMessage(agent.agentId, question, { ...sendOptions, signal }),
  );
}

async function buildAskSettings(opts: AskOpts): Promise<AskRuntimeSettings> {
  const configDefaults = await loadAskConfigDefaults(opts.config);
  const fastModel = opts.fastModel ?? configDefaults.fastModel;
  const maxSteps = parseOptionalMaxSteps(opts.maxSteps);
  if (opts.fast && fastModel === undefined) {
    throw new CliUserError("--fast requires provider.fast_model in config.yaml or --fast-model");
  }
  return {
    askTimeoutMs: parseOptionalPositiveInt(opts.askTimeoutMs, configDefaults.askTimeoutMs),
    useFast: Boolean(opts.fast),
    ...(fastModel === undefined ? {} : { fastModel }),
    ...(maxSteps === undefined ? {} : { maxSteps }),
  };
}

async function runBroadcastAsk(repo: string | undefined, opts: AskOpts): Promise<void> {
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

  const askSettings = await buildAskSettings(opts);
  const askAllConfig = await loadConfigSafe(path.resolve(opts.config ?? "config.yaml"));
  const provider = createProvider(askAllConfig);
  const agents = entries.map(([repoName, agent]) => ({ repoName, agentId: agent.agentId }));

  console.log(`Broadcasting to ${String(agents.length)} agents...`);
  const results = await broadcastAsk(provider, agents, actualQuestion, {
    timeoutMs: parseIntOrDefault(opts.timeout, BROADCAST_ASK_DEFAULT_TIMEOUT_MS),
    ...(askSettings.useFast && askSettings.fastModel !== undefined ? { overrideModel: askSettings.fastModel } : {}),
  });

  for (const result of results) {
    console.log(`\n--- ${result.repoName} ---`);
    if (result.error) {
      console.error(`  Error: ${result.error}`);
    } else {
      console.log(result.response);
    }
  }
}

async function runSingleAsk(repo: string | undefined, question: string | undefined, opts: AskOpts): Promise<void> {
  if (!repo || !question) {
    console.error("Usage: repo-expert ask <repo> <question>");
    console.error("       repo-expert ask --all <question>");
    process.exitCode = 1;
    return;
  }

  const state = await loadState(STATE_FILE);
  const agentInfo = requireAgent(state, repo);
  if (!agentInfo) return;

  const askConfig = await loadConfigSafe(path.resolve(opts.config ?? "config.yaml"));
  const provider = createProviderForCommands(askConfig);
  const askSettings = await buildAskSettings(opts);
  const stop = startSpinner(`Asking ${repo}...`);
  try {
    const answer = await askAgent(provider, agentInfo, question, askSettings);
    stop();
    console.log(answer);
  } catch (error) {
    stop();
    throw error;
  }
}

function startSpinner(label: string): () => void {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const id = setInterval(() => {
    process.stderr.write(`\r${frames[i++ % frames.length]} ${label}`);
  }, 80);
  return () => {
    clearInterval(id);
    process.stderr.write("\r\u001B[K");
  };
}

// --- Program ---

const program = new Command();
program.name("repo-expert").description("Persistent AI agents for git repositories").version(readPackageVersion());
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
  .description("Interactive setup: pick model + LLM endpoint, scan a repo, generate config.yaml")
  .option("--model <model>", "Chat model id as the LLM endpoint knows it")
  .option("--base-url <url>", "OpenAI-compatible LLM base URL (default: local Ollama)")
  .option("--embedding-engine <engine>", "Embedding engine: http (default) or transformersjs")
  .option("--api-key <key>", "Optional LLM Bearer key to write to .env as LLM_API_KEY (non-interactive)")
  .option("--repo-path <path>", "Repository path to configure")
  .option("-y, --yes", "Accept defaults and skip confirmation prompts")
  .action(async (opts: InitOpts) => {
    if (opts.embeddingEngine !== undefined && !isValidEmbeddingEngine(opts.embeddingEngine)) {
      console.error(`Invalid --embedding-engine "${opts.embeddingEngine}". Use "http" or "transformersjs".`);
      process.exitCode = 1;
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const initOptions = {
        ...(opts.apiKey === undefined ? {} : { apiKey: opts.apiKey }),
        ...(opts.repoPath === undefined ? {} : { repoPath: opts.repoPath }),
        ...(opts.model === undefined ? {} : { model: opts.model }),
        ...(opts.baseUrl === undefined ? {} : { baseUrl: opts.baseUrl }),
        ...(opts.embeddingEngine === undefined ? {} : { embeddingEngine: opts.embeddingEngine }),
        assumeYes: Boolean(opts.yes),
        allowPrompts: !noInputEnabled() && interactiveInputAvailable(),
      };
      await runInit({ question: (prompt) => question(rl, prompt) }, {
        ...initOptions,
      });
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
  .option("--fix", "Apply safe automatic remediations before checks")
  .option("--strict", "Promote warnings to failures (non-zero exit)")
  .action(async (opts: DoctorOpts) => {
    const configPath = path.resolve(opts.config);
    let fixed: Awaited<ReturnType<typeof runDoctorFixes>> | null = null;
    if (opts.fix) {
      fixed = await runDoctorFixes(configPath);
      if (!opts.json) {
        for (const line of fixed.applied) console.log(`FIXED: ${line}`);
        for (const line of fixed.suggestions) console.log(`NOTE: ${line}`);
      }
    }

    let provider: AgentProvider | null = null;
    try {
      const doctorConfig = await loadConfigSafe(configPath);
      provider = createProviderForCommands(doctorConfig);
    } catch {
      // provider stays null if config is missing or API key is absent
    }
    const results = await runAllChecks(provider, configPath);
    if (opts.json) {
      console.log(JSON.stringify({ fixes: fixed, checks: results }, null, 2));
    } else {
      console.log(formatDoctorReport(results));
    }
    const exitCode = computeDoctorExitCode(results, Boolean(opts.strict));
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("self-check")
  .description("Check local runtime/toolchain health (Node, pnpm, dependencies)")
  .option("--json", "Output checks as JSON")
  .action(async (opts: SelfCheckOpts) => {
    const results = await runSelfChecks(process.cwd());
    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(formatSelfChecks(results));
    }
    if (results.some((r) => r.status === "fail")) process.exitCode = 1;
  });

program
  .command("setup")
  .description("Create agents from config.yaml")
  .option("--repo <name>", "Set up a single repo")
  .option("--config <path>", "Config file path", "config.yaml")
  .option("--resume", "Resume incomplete setup work (default behavior)")
  .option("--reindex", "Force full re-index for existing agents")
  .option("--no-bootstrap", "Skip the bootstrap analysis stage")
  .option("--json", "Output setup results as JSON")
  .option("--load-retries <n>", "Retries for passage loading", "2")
  .option("--bootstrap-retries <n>", "Retries for bootstrap stage", "2")
  .option("--load-timeout-ms <ms>", "Timeout for passage loading stage", "300000")
  .option("--bootstrap-timeout-ms <ms>", "Timeout for bootstrap stage", "120000")
  .option("--skip-preflight", "Skip the LLM endpoint/model reachability check before indexing")
  // eslint-disable-next-line sonarjs/cognitive-complexity
  .action(async (opts: SetupOpts) => {
    if (opts.resume && opts.reindex) {
      console.error("Choose either --resume or --reindex, not both.");
      process.exitCode = 1;
      return;
    }

    const log = opts.json ? (_: string) => {} : (line: string) => { console.log(line); };
    const warn = opts.json ? (_: string) => {} : (line: string) => { console.warn(line); };
    const loadRetries = parseNonNegativeInt(opts.loadRetries, 2);
    const bootstrapRetries = parseNonNegativeInt(opts.bootstrapRetries, 2);
    const loadTimeoutMs = parseNonNegativeInt(opts.loadTimeoutMs, 300_000);
    const bootstrapTimeoutMs = parseNonNegativeInt(opts.bootstrapTimeoutMs, 120_000);

    const configPath = path.resolve(opts.config);
    const config = await loadConfigSafe(configPath);

    const skipPreflight = Boolean(opts.skipPreflight) || process.env["REPO_EXPERT_TEST_FAKE_PROVIDER"] === "1";
    if (!skipPreflight) {
      const preflight = await runSetupPreflight(config);
      for (const warning of preflight.warnings) console.warn(warning);
      if (!preflight.ok) {
        for (const message of preflight.errors) console.error(message);
        console.error('Run with --skip-preflight to bypass this check.');
        process.exitCode = 1;
        return;
      }
    }

    const chunkingStrategy = await prepareChunking();
    const provider = createProviderForCommands(config);
    let state = await loadState(STATE_FILE);

    const repoNames = opts.repo ? [opts.repo] : Object.keys(config.repos);
    const setupResults: Array<Record<string, unknown>> = [];

    for (const repoName of repoNames) {
      const repoStart = Date.now();
      const repoConfig = getOwnRecordValue(config.repos, repoName);
      if (repoConfig === undefined) {
        const message = `Repo "${repoName}" not found in config`;
        console.error(message);
        setupResults.push({ repoName, status: "error", error: message, totalMs: Date.now() - repoStart });
        process.exitCode = 1;
        continue;
      }

      const existingAgent = getOwnRecordValue(state.agents, repoName);
      const mode = getSetupMode(existingAgent, opts.bootstrap, {
        forceResume: Boolean(opts.resume),
        forceReindex: Boolean(opts.reindex),
      });

      if (mode === "skip") {
        if (existingAgent === undefined) {
          const message = `Agent for "${repoName}" is missing from state`;
          console.error(message);
          setupResults.push({ repoName, status: "error", error: message, mode, totalMs: Date.now() - repoStart });
          process.exitCode = 1;
          continue;
        }
        log(`Agent for "${repoName}" already exists (${existingAgent.agentId}), skipping`);
        setupResults.push({
          repoName,
          status: "skipped",
          mode,
          agentId: existingAgent.agentId,
          totalMs: Date.now() - repoStart,
        });
        continue;
      }

      log(`Setting up "${repoName}"...`);
      let createMs = 0;
      let indexMs = 0;
      let bootstrapMs = 0;
      let filesFound = 0;
      let chunksLoaded = 0;

      let agentId: string;
      try {
        if (mode === "create") {
          const createStart = Date.now();
          const modelOptions = { model: config.provider.model };
          const agentState = await createRepoAgent(provider, repoName, repoConfig, modelOptions);
          agentId = agentState.agentId;
          createMs = Date.now() - createStart;
          log(`  Agent created: ${agentId} (${formatDurationMs(createMs)})`);
          state = addAgentToState(state, repoName, agentId, new Date().toISOString());
          await saveState(STATE_FILE, state);
        } else {
          if (existingAgent === undefined) {
            throw new Error(`Cannot resume setup for "${repoName}": missing existing agent`);
          }
          agentId = existingAgent.agentId;
          if (mode === "resume_bootstrap") {
            log(`  Resuming bootstrap for existing agent (${agentId})...`);
          } else {
            log(`  Resuming indexing for existing agent (${agentId})...`);
          }
        }

        if (mode === "create" || mode === "resume_full" || mode === "reindex_full") {
          const indexStart = Date.now();
          log(`  Collecting files from ${repoConfig.path}...`);
          const files = await collectFiles(repoConfig);
          filesFound = files.length;
          log(`  Found ${String(files.length)} files`);

          const chunks = files.flatMap((f) => chunkingStrategy(f));
          chunksLoaded = chunks.length;
          log(`  Loading ${String(chunks.length)} passages...`);
          const loadResult = await withRetry(
            `loading passages for "${repoName}"`,
            loadRetries,
            () => withTimeout(
              `Loading passages for "${repoName}"`,
              loadTimeoutMs,
              () => loadPassages(provider, agentId, chunks, 20, opts.json ? undefined : printProgress),
            ),
            warn,
          );
          if (chunks.length > 0 && !opts.json) process.stdout.write("\n");
          if (loadResult.failedChunks > 0) {
            warn(`${String(loadResult.failedChunks)}/${String(chunks.length)} chunks failed to load`);
          }
          const fileHashes = Object.fromEntries(
            files.map((file) => [file.path, hashFileContent(file.content)]),
          );
          state = updatePassageMap(state, repoName, loadResult.passages);
          state = updateAgentField(state, repoName, { fileHashes });
          await saveState(STATE_FILE, state);
          indexMs = Date.now() - indexStart;
          log(`  Index phase completed in ${formatDurationMs(indexMs)}.`);
        }

        // Store HEAD commit so incremental sync works immediately
        const headCommit = nodeGit.headCommit(repoConfig.path);
        if (headCommit) {
          state = updateAgentField(state, repoName, { lastSyncCommit: headCommit });
          await saveState(STATE_FILE, state);
        }

        if (opts.bootstrap) {
          const bootstrapStart = Date.now();
          log(`  Bootstrapping...`);
          await withRetry(
            `bootstrap for "${repoName}"`,
            bootstrapRetries,
            () => withTimeout(`Bootstrap for "${repoName}"`, bootstrapTimeoutMs, () => bootstrapAgent(provider, agentId)),
            warn,
          );
          state = updateAgentField(state, repoName, { lastBootstrap: new Date().toISOString() });
          await saveState(STATE_FILE, state);
          bootstrapMs = Date.now() - bootstrapStart;
          log(`  Bootstrap complete (${formatDurationMs(bootstrapMs)}).`);
        }

        const totalMs = Date.now() - repoStart;
        log(`  Done: "${repoName}" (${formatDurationMs(totalMs)}).`);
        setupResults.push({
          repoName,
          status: "ok",
          mode,
          agentId,
          filesFound,
          chunksLoaded,
          createMs,
          indexMs,
          bootstrapMs,
          totalMs,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Setup failed for "${repoName}": ${message}`);
        setupResults.push({
          repoName,
          status: "error",
          mode,
          error: message,
          totalMs: Date.now() - repoStart,
        });
        process.exitCode = 1;
      }
    }

    if (opts.json) {
      console.log(JSON.stringify({ results: setupResults }, null, 2));
    } else {
      console.log("Setup complete.");
      const exampleRepoName = repoNames[0] ?? "my-repo";
      for (const line of buildPostSetupNextSteps(exampleRepoName)) {
        console.log(line);
      }
    }
  });

const configCommand = program.command("config").description("Configuration helpers");

configCommand
  .command("lint")
  .description("Validate config.yaml structure and semantics")
  .option("--config <path>", "Config file path", "config.yaml")
  .option("--json", "Output lint report as JSON")
  .action(async (opts: ConfigLintOpts) => {
    const configPath = path.resolve(opts.config);
    try {
      const config = await loadConfigSafe(configPath);
      const summary = {
        ok: true,
        configPath,
        repoCount: Object.keys(config.repos).length,
        repos: Object.keys(config.repos),
      };
      if (opts.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log(`Config OK: ${String(summary.repoCount)} repo(s) in ${configPath}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, configPath, issues: [message] }, null, 2));
      } else {
        console.error(message);
      }
      process.exitCode = 1;
    }
  });

program
  .command("ask [repo] [question]")
  .description("Ask an agent a question")
  .option("--all", "Ask all agents and collect responses")
  .option("--timeout <ms>", "Per-agent timeout for --all (ms)", String(BROADCAST_ASK_DEFAULT_TIMEOUT_MS))
  .option("--fast", "Use the fast model from config for this query")
  .option("--fast-model <model>", "Override the fast model for this query")
  .option("--ask-timeout-ms <ms>", "Timeout for single-agent asks (ms)")
  .option("--max-steps <n>", "Maximum agent reasoning/tool steps per ask")
  .option("--config <path>", "Optional config file path for ask defaults")
  .action(async (repo: string | undefined, question: string | undefined, opts: AskOpts) => {
    if (opts.all) {
      await runBroadcastAsk(repo, opts);
      return;
    }

    await runSingleAsk(repo, question, opts);
  });

program
  .command("sync")
  .description("Sync file changes to agents")
  .option("--repo <name>", "Sync a single repo")
  .option("--full", "Full re-index instead of incremental")
  .option("--since <ref>", "Git ref to diff from (overrides stored commit)")
  .option("--config <path>", "Config file path", "config.yaml")
  .option("--json", "Output sync results as JSON")
  .option("--dry-run", "Preview sync plan without writing state or calling the provider")
  // eslint-disable-next-line sonarjs/cognitive-complexity
  .action(async (opts: SyncOpts) => {
    const log = opts.json ? (_: string) => {} : (line: string) => { console.log(line); };
    const configPath = path.resolve(opts.config);
    const config = await loadConfigSafe(configPath);
    await prepareChunking();
    const provider = opts.dryRun ? null : createProviderForCommands(config);
    let state = await loadState(STATE_FILE);
    const syncResults: Array<Record<string, unknown>> = [];

    const repoNames = opts.repo ? [opts.repo] : Object.keys(state.agents);

    for (const repoName of repoNames) {
      const agentInfo = requireAgent(state, repoName);
      if (!agentInfo) return;

      const repoConfig = getOwnRecordValue(config.repos, repoName);
      if (repoConfig === undefined) {
        const message = `Repo "${repoName}" not found in config`;
        console.error(message);
        syncResults.push({ repoName, status: "error", error: message });
        process.exitCode = 1;
        continue;
      }

      const headCommit = nodeGit.headCommit(repoConfig.path);
      if (!headCommit && (!opts.dryRun || !opts.full)) {
        const message = `"${repoName}": not a git repository or git is not available (${repoConfig.path})`;
        console.error(message);
        syncResults.push({ repoName, status: "error", error: message });
        process.exitCode = 1;
        continue;
      }

      let changedFiles: string[];
      // The evidence window consolidation will use — always the same source
      // the sync itself used, never re-derived from (possibly stale) state.
      // Null only under --full, which has no diff window.
      let syncEvidenceSource: EvidenceSource | null = null;
      if (opts.full) {
        const files = await collectFiles(repoConfig);
        changedFiles = files.map((f) => f.path);
        log(`Syncing "${repoName}" (full re-index, ${String(changedFiles.length)} files)...`);
      } else if (opts.since) {
        // Explicit override: the user named a specific ref, so an invalid one
        // is a user error — fail loudly rather than degrade.
        const diff = nodeGit.diffFiles(repoConfig.path, opts.since);
        if (diff === null) {
          const message = `"${repoName}": git diff failed. Is "${opts.since}" a valid ref?`;
          console.error(message);
          syncResults.push({ repoName, status: "error", error: message });
          process.exitCode = 1;
          continue;
        }
        changedFiles = await filterChangedFiles(diff, repoConfig);
        syncEvidenceSource = { kind: "range", from: opts.since };
        log(`Syncing "${repoName}" (${String(changedFiles.length)} changed files since ${opts.since.slice(0, 7)})...`);
      } else if (agentInfo.lastSyncCommit) {
        const checkpoint = agentInfo.lastSyncCommit;
        if (!nodeGit.commitExists(repoConfig.path, checkpoint)) {
          // The stored checkpoint is authoritative. If it is gone (rebase,
          // force-push, gc), refuse to guess a diff window — recovery is
          // only ever explicit.
          const message = `"${repoName}": ${formatOrphanedCheckpointMessage(checkpoint)}`;
          console.error(message);
          syncResults.push({ repoName, status: "error", error: message });
          process.exitCode = 1;
          continue;
        }
        const diff = nodeGit.diffFiles(repoConfig.path, checkpoint);
        if (diff === null) {
          const message = `"${repoName}": git diff failed. Is "${checkpoint}" a valid ref?`;
          console.error(message);
          syncResults.push({ repoName, status: "error", error: message });
          process.exitCode = 1;
          continue;
        }
        changedFiles = await filterChangedFiles(diff, repoConfig);
        syncEvidenceSource = { kind: "range", from: checkpoint };
        log(`Syncing "${repoName}" (${String(changedFiles.length)} changed files since ${checkpoint.slice(0, 7)})...`);
      } else {
        log(`No previous sync for "${repoName}". Run "repo-expert sync --full" or re-run "repo-expert setup".`);
        syncResults.push({ repoName, status: "skipped", reason: "no_previous_sync" });
        continue;
      }

      if (changedFiles.length === 0) {
        log(`  No changes to sync.`);
        if (!opts.dryRun) {
          state = updateAgentField(state, repoName, { lastSyncCommit: headCommit });
          await saveState(STATE_FILE, state);
        }
        syncResults.push({ repoName, status: "ok", dryRun: Boolean(opts.dryRun), changedFiles: 0 });
        continue;
      }

      if (opts.dryRun) {
        syncResults.push({
          repoName,
          status: "ok",
          dryRun: true,
          changedFiles: changedFiles.length,
          headCommit: headCommit ?? "dry-run",
        });
        log(`  Dry-run: would sync ${String(changedFiles.length)} files.`);
        continue;
      }

      if (!headCommit) {
        const message = `"${repoName}": missing git HEAD commit`;
        console.error(message);
        syncResults.push({ repoName, status: "error", error: message });
        process.exitCode = 1;
        continue;
      }

      if (provider === null) {
        throw new Error(`"${repoName}": provider unavailable for non-dry-run sync`);
      }
      const isTTY = !opts.json && process.stderr.isTTY;
      const syncParams = {
        provider,
        agent: agentInfo,
        changedFiles,
        collectFile: async (filePath: string) => {
          const absPath = path.join(repoConfig.path, filePath);
          try {
            const fs = await import("node:fs/promises");
            const content = await fs.readFile(absPath, "utf8");
            const stat = await fs.stat(absPath);
            return { path: filePath, content, sizeKb: stat.size / 1024 };
          } catch {
            return null;
          }
        },
        headCommit,
        maxFileSizeKb: MAX_FILE_SIZE_KB,
        ...(isTTY ? {
          onProgress: (completed: number, total: number, filePath: string) => {
            const label = filePath.length > 60 ? `...${filePath.slice(-57)}` : filePath;
            process.stderr.write(`\r  [${String(completed)}/${String(total)}] ${label.padEnd(60)}`);
          },
        } : {}),
      };
      const result = await syncRepo(syncParams);

      if (isTTY) process.stderr.write(`\r${" ".repeat(72)}\r`); // clear progress line

      if (result.isFullReIndex) {
        log(`  Warning: ${String(changedFiles.length)} files changed — consider --full re-index`);
      }

      log(
        `  Removed: ${String(result.filesRemoved)} files, Re-indexed: ${String(result.filesReIndexed)} files, Skipped (unchanged): ${String(result.filesSkippedUnchanged)} files`,
      );

      state = updateAgentField(state, repoName, {
        passages: result.passages,
        fileHashes: result.fileHashes,
        lastSyncCommit: result.lastSyncCommit,
      });
      await saveState(STATE_FILE, state);

      if (shouldConsolidate(result, config.consolidateOnSync)) {
        // Evidence comes from the exact window this sync just used — never
        // re-derived from pre-sync state.
        let gitEvidence = "";
        if (syncEvidenceSource) {
          gitEvidence = formatGitEvidence(nodeGit.logNameStatus(repoConfig.path, syncEvidenceSource), GIT_EVIDENCE_MAX_CHARS);
        } else {
          log(`  Git evidence omitted from consolidation: full re-index has no diff window.`);
        }
        const consolidation = await consolidateAgentMemory({
          provider,
          agentId: agentInfo.agentId,
          changedFiles,
          syncResult: result,
          blockCharLimit: MEMORY_BLOCK_LIMIT,
          gitEvidence,
          log,
        });
        if (consolidation.consolidated && consolidation.changed) {
          state = updateAgentField(state, repoName, { lastConsolidatedCommit: headCommit });
          await saveState(STATE_FILE, state);
          log(`  Consolidated architecture/conventions memory blocks.`);
        }
      }

      log(`  Done.`);
      syncResults.push({
        repoName,
        status: "ok",
        dryRun: false,
        changedFiles: changedFiles.length,
        filesRemoved: result.filesRemoved,
        filesReIndexed: result.filesReIndexed,
        isFullReIndex: result.isFullReIndex,
      });
    }

    if (opts.json) {
      console.log(JSON.stringify({ results: syncResults }, null, 2));
    }
  });

program
  .command("list")
  .description("List all agents")
  .option("--json", "Output agent list as JSON")
  .option("--live", "Fetch live passage counts from the provider (slower)")
  // eslint-disable-next-line sonarjs/cognitive-complexity
  .action(async (opts: ListOpts) => {
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

    const rows: Array<{
      repoName: string;
      agentId: string;
      files: number;
      passages: number;
      bootstrapped: boolean;
      serverPassages?: number;
      drift?: boolean;
    }> = entries.map(([repoName, agent]) => ({
      repoName,
      agentId: agent.agentId,
      files: Object.keys(agent.passages).length,
      passages: Object.values(agent.passages).flat().length,
      bootstrapped: Boolean(agent.lastBootstrap),
    }));

    if (opts.live) {
      const listConfig = await loadConfigForProvider(path.resolve("config.yaml"));
      const provider = createProviderForCommands(listConfig);
      for (const row of rows) {
        const serverPassages = await provider.listPassages(row.agentId);
        row.serverPassages = serverPassages.length;
        row.drift = row.passages !== serverPassages.length;
      }
    }

    if (opts.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    for (const row of rows) {
      const bootstrap = row.bootstrapped ? "yes" : "no";
      if (opts.live) {
        const driftTag = row.drift ? " [drift]" : "";
        console.log(
          `  ${row.repoName}: agent=${row.agentId} files=${String(row.files)} passages=${String(row.passages)} server=${String(row.serverPassages)}${driftTag} bootstrapped=${bootstrap}`,
        );
      } else {
        console.log(`  ${row.repoName}: agent=${row.agentId} files=${String(row.files)} passages=${String(row.passages)} bootstrapped=${bootstrap}`);
      }
    }
  });

program
  .command("status")
  .description("Show agent memory stats and health")
  .option("--repo <name>", "Show status for a single repo")
  .option("--json", "Output status as JSON")
  .action(async (opts: RepoOpts) => {
    const state = await loadState(STATE_FILE);
    const statusConfig = await loadConfigForProvider(path.resolve("config.yaml"));
    const provider = createProviderForCommands(statusConfig);
    const repoNames = opts.repo ? [opts.repo] : Object.keys(state.agents);
    const rows: unknown[] = [];

    for (const repoName of repoNames) {
      const agentInfo = requireAgent(state, repoName);
      if (!agentInfo) return;

      if (opts.json) {
        rows.push(await getAgentStatusData(provider, repoName, agentInfo));
      } else {
        const output = await getAgentStatus(provider, repoName, agentInfo);
        console.log(output);
      }
    }

    if (opts.json) {
      console.log(JSON.stringify(rows, null, 2));
    }
  });

program
  .command("consolidate")
  .description("Consolidate architecture/conventions memory blocks via the LLM")
  .option("--repo <name>", "Consolidate a single repo agent")
  .option("--config <path>", "Config file path", "config.yaml")
  .action(async (opts: ConsolidateCliOpts) => {
    let state = await loadState(STATE_FILE);
    const config = await loadConfigForProvider(path.resolve(opts.config));
    const provider = createProviderForCommands(config);
    const repoNames = opts.repo ? [opts.repo] : Object.keys(state.agents);

    for (const repoName of repoNames) {
      const agentInfo = requireAgent(state, repoName);
      if (!agentInfo) return;

      state = await consolidateRepoAgent({ state, repoName, agentInfo, config, provider });
    }
  });

program
  .command("export")
  .description("Export agent memory to markdown")
  .option("--repo <name>", "Export a single repo agent")
  .action(async (opts: RepoOpts) => {
    const state = await loadState(STATE_FILE);
    const exportConfig = await loadConfigSafe(path.resolve("config.yaml"));
    const provider = createProvider(exportConfig);
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
  .option("--timeout-ms <ms>", "Timeout for the onboarding walkthrough", String(ONBOARD_DEFAULT_TIMEOUT_MS))
  .action(async (repo: string, opts: OnboardOpts) => {
    const state = await loadState(STATE_FILE);
    const agentInfo = requireAgent(state, repo);
    if (!agentInfo) return;

    const onboardConfig = await loadConfigSafe(path.resolve("config.yaml"));
    const provider = createProviderForCommands(onboardConfig);
    const timeoutMs = parseOptionalPositiveInt(opts.timeoutMs, ONBOARD_DEFAULT_TIMEOUT_MS);
    console.error(`Generating onboarding walkthrough for "${repo}" (this can take a while)...`);
    const walkthrough = await withTimeoutSignal(
      `Onboarding "${repo}"`,
      timeoutMs,
      (signal) => onboardAgent(provider, repo, agentInfo.agentId, { signal }),
    );
    console.log(walkthrough);
  });

program
  .command("destroy")
  .description("Delete agents")
  .option("--repo <name>", "Destroy a single repo agent")
  .option("--force", "Skip confirmation prompt")
  .option("--dry-run", "Preview agents that would be deleted")
  .action(async (opts: DestroyOpts) => {
    const state = await loadState(STATE_FILE);
    const repoNames = opts.repo ? [opts.repo] : Object.keys(state.agents);
    const existing = repoNames.filter((n) => Object.hasOwn(state.agents, n));

    if (existing.length === 0) {
      console.log("No agents to destroy.");
      return;
    }

    if (opts.dryRun) {
      console.log(`Dry-run: would delete ${String(existing.length)} agent(s): ${existing.join(", ")}`);
      return;
    }

    if (!opts.force && !(await confirmDestroy(existing))) {
      return;
    }

    const destroyConfig = await loadConfigForProvider(path.resolve("config.yaml"));
    const provider = createProviderForCommands(destroyConfig);
    await destroyAgents(provider, state, existing);

    let newState = state;
    for (const repoName of existing) {
      newState = removeAgentFromState(newState, repoName);
    }
    await saveState(STATE_FILE, newState);
    console.log("Done.");
  });

program
  .command("reconcile")
  .description("Compare local passage state against the provider's actual state and report drift")
  .option("--repo <name>", "Reconcile a single repo agent (default: all)")
  .option("--fix", "Delete orphan passages and clean up stale local entries")
  .option("--json", "Output reconcile results as JSON")
  .option("--verbose", "Include full passage ID lists in JSON output")
  // eslint-disable-next-line sonarjs/cognitive-complexity
  .action(async (opts: ReconcileOpts) => {
    let state = await loadState(STATE_FILE);
    const repoNames = opts.repo ? [opts.repo] : Object.keys(state.agents);
    const existing = repoNames.filter((n) => Object.hasOwn(state.agents, n));

    if (existing.length === 0) {
      console.log('No agents found. Run "repo-expert setup" to create them.');
      return;
    }

    const reconcileConfig = await loadConfigForProvider(path.resolve("config.yaml"));
    const provider = createProviderForCommands(reconcileConfig);
    const results: ReconcileResult[] = [];
    let anyDrift = false;

    for (const repoName of existing) {
      const agent = getOwnRecordValue(state.agents, repoName);
      if (agent === undefined) {
        continue;
      }
      const result = await reconcileAgent(provider, agent);
      results.push(result);
      if (!result.inSync) anyDrift = true;
    }

    if (opts.fix && anyDrift) {
      for (const result of results) {
        if (result.inSync) continue;
        const agent = getOwnRecordValue(state.agents, result.repoName);
        if (agent === undefined) {
          continue;
        }
        const updatedPassages = await fixReconcileDrift(provider, agent, result);
        state = updateAgentField(state, result.repoName, { passages: updatedPassages });
      }
      await saveState(STATE_FILE, state);
    }

    if (opts.json) {
      const jsonResults = results.map((r) => ({
        repoName: r.repoName,
        localPassageCount: r.localPassageCount,
        serverPassageCount: r.serverPassageCount,
        orphanCount: r.orphanPassageIds.length,
        missingCount: r.missingPassageIds.length,
        inSync: r.inSync,
        fixed: Boolean(opts.fix) && !r.inSync,
        ...(opts.verbose ? { orphanPassageIds: r.orphanPassageIds, missingPassageIds: r.missingPassageIds } : {}),
      }));
      console.log(JSON.stringify(jsonResults, null, 2));
      if (anyDrift && !opts.fix) process.exitCode = 1;
      return;
    }

    for (const result of results) {
      if (result.inSync) {
        console.log(`${result.repoName}: in sync (${String(result.serverPassageCount)} passages)`);
      } else {
        console.log(`${result.repoName}: drift detected`);
        if (result.orphanPassageIds.length > 0) {
          console.log(`  orphan passages (on server, not in local map): ${String(result.orphanPassageIds.length)}`);
        }
        if (result.missingPassageIds.length > 0) {
          console.log(`  missing passages (in local map, not on server): ${String(result.missingPassageIds.length)}`);
        }
        if (opts.fix) console.log(`  fixed.`);
      }
    }

    if (anyDrift && !opts.fix) process.exitCode = 1;
  });

program
  .command("watch")
  .description("Watch repos and auto-sync on repo changes")
  .option("--repo <name>", "Watch a single repo")
  .option("--interval <seconds>", "Poll interval in seconds", String(DEFAULT_WATCH_CONFIG.intervalMs / 1000))
  .option("--debounce <ms>", "Debounce window for file-change batching", String(DEFAULT_WATCH_CONFIG.debounceMs))
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
      if (!Object.hasOwn(config.repos, name)) {
        console.error(`Repo "${name}" not found in config`);
        process.exitCode = 1;
        return;
      }
    }

    const intervalMs = Math.max(1, parseIntOrDefault(opts.interval, DEFAULT_WATCH_CONFIG.intervalMs / 1000)) * 1000;
    const debounceMs = Math.max(50, parseIntOrDefault(opts.debounce, DEFAULT_WATCH_CONFIG.debounceMs));
    const provider = createProvider(config);
    const ac = new AbortController();

    const shutdown = () => { ac.abort(); };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    console.log(
      `Watching ${String(repoNames.length)} repo(s) (poll every ${String(intervalMs / 1000)}s, debounce ${String(debounceMs)}ms). Press Ctrl+C to stop.`,
    );

    try {
      await watchRepos({
        provider,
        config,
        repoNames,
        statePath: STATE_FILE,
        intervalMs,
        debounceMs,
        signal: ac.signal,
      });
    } catch (error) {
      if (error instanceof OrphanedCheckpointError) {
        console.error(`Watch stopped: ${formatOrphanedCheckpointMessage(error.commit)}`);
        process.exitCode = 1;
        return;
      }
      throw error;
    }

    console.log("Watch stopped.");
  });

program
  .command("install-daemon")
  .description("Install launchd daemon for auto-sync on macOS")
  .option("--interval <seconds>", "Poll interval in seconds", String(DEFAULT_WATCH_CONFIG.intervalMs / 1000))
  .option("--debounce <ms>", "Debounce window for file-change batching", String(DEFAULT_WATCH_CONFIG.debounceMs))
  .option("--config <path>", "Config file path", "config.yaml")
  .action(async (opts: InstallDaemonOpts) => {
    if (process.platform !== "darwin") {
      console.error("install-daemon is only supported on macOS (launchd).");
      process.exitCode = 1;
      return;
    }

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const home = os.default.homedir();

    const plistPath = path.join(home, "Library/LaunchAgents", `${PLIST_LABEL}.plist`);
    const logPath = path.join(home, "Library/Logs/repo-expert-watch.log");

    const seaBinary = path.resolve(process.cwd(), "dist", "repo-expert");
    const sharedDaemonOpts = {
      workingDirectory: process.cwd(),
      intervalSeconds: parseIntOrDefault(opts.interval, DEFAULT_WATCH_CONFIG.intervalMs / 1000),
      debounceMs: Math.max(50, parseIntOrDefault(opts.debounce, DEFAULT_WATCH_CONFIG.debounceMs)),
      configPath: opts.config,
      logPath,
    };

    let plist: string;
    if (await pathExists(seaBinary)) {
      console.log(`Using SEA binary: ${seaBinary}`);
      plist = generatePlist({ ...sharedDaemonOpts, binaryPath: seaBinary });
    } else {
      const nodePath = await resolveNodeExecutable();
      if (!nodePath) {
        console.error("Cannot find a usable Node.js executable. Install Node and try again.");
        process.exitCode = 1;
        return;
      }
      const tsxCliPath = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
      if (!(await pathExists(tsxCliPath))) {
        console.error("Cannot find local tsx CLI at node_modules/tsx/dist/cli.mjs. Run pnpm install and try again.");
        process.exitCode = 1;
        return;
      }
      plist = generatePlist({ ...sharedDaemonOpts, nodePath, tsxCliPath });
    }

    // Unload existing daemon if present
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- launchctl must be resolved from PATH
      execFileSync("launchctl", ["unload", plistPath], { stdio: "pipe" });
    } catch {
      // Not loaded — fine
    }

    await fs.mkdir(path.dirname(plistPath), { recursive: true });
    await fs.writeFile(plistPath, plist, "utf8");
    console.log(`Plist written: ${plistPath}`);

    // eslint-disable-next-line sonarjs/no-os-command-from-path -- launchctl must be resolved from PATH
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

    const os = await import("node:os");
    const fs = await import("node:fs/promises");
    const home = os.default.homedir();
    const plistPath = path.join(home, "Library/LaunchAgents", `${PLIST_LABEL}.plist`);

    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- launchctl must be resolved from PATH
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

interface InstallInstructionsOpts {
  repo?: string;
  config: string;
  file?: string;
  remove?: boolean;
  dryRun?: boolean;
}

interface McpInstallOpts {
  global?: boolean;
  local?: boolean;
  config: string;
}

interface McpCheckOpts {
  json?: boolean;
  config: string;
}

interface CompletionOpts {
  installDir?: string;
}

const MCP_ENTRY_NAME = "repo-expert";

/**
 * Decide how the MCP server should be launched: a SEA binary next to the
 * CLI if one exists, the bundled dist/bin/mcp-server.mjs when running the
 * npm-installed package, or npx tsx against the source checkout in dev.
 */
async function resolveMcpLaunch(): Promise<McpLaunchSpec> {
  const seaBinary = path.resolve(process.cwd(), "dist", "repo-expert-mcp");
  const binaryPath = (await pathExists(seaBinary)) ? seaBinary : undefined;
  return resolveMcpLaunchSpec(fileURLToPath(import.meta.url), binaryPath);
}

function printInstallInstructionsOutcome(prefix: string, repoName: string, outcome: { path: string; action: string; warning?: string }): void {
  if (outcome.action === "unchanged") {
    console.log(`${prefix}${repoName}: ${outcome.path} already up to date`);
  } else {
    console.log(`${prefix}${repoName}: ${outcome.action} ${outcome.path}`);
  }
  if (outcome.warning) console.warn(`  Warning: ${outcome.warning}`);
}

async function runInstallInstructionsForRepo(
  repoName: string,
  config: Config,
  opts: InstallInstructionsOpts,
  prefix: string,
): Promise<void> {
  const repoConfig = getOwnRecordValue(config.repos, repoName);
  if (repoConfig === undefined) {
    console.error(`Repo "${repoName}" not found in config`);
    process.exitCode = 1;
    return;
  }

  const outcomes = await installInstructions({
    repoPath: repoConfig.path,
    repoNames: [repoName],
    remove: Boolean(opts.remove),
    dryRun: Boolean(opts.dryRun),
    ...(opts.file === undefined ? {} : { filePath: opts.file }),
  });

  for (const outcome of outcomes) {
    printInstallInstructionsOutcome(prefix, repoName, outcome);
  }
}

program
  .command("install-instructions")
  .description("Inject repo-expert usage instructions into a repo's CLAUDE.md/AGENTS.md")
  .option("--repo <name>", "Install for a single repo (default: all configured repos)")
  .option("--config <path>", "Config file path", "config.yaml")
  .option("--file <path>", "Explicit target file path (overrides CLAUDE.md/AGENTS.md discovery)")
  .option("--remove", "Remove the repo-expert instructions block instead of installing it")
  .option("--dry-run", "Preview without writing files")
  .action(async (opts: InstallInstructionsOpts) => {
    const configPath = path.resolve(opts.config);
    const config = await loadConfigSafe(configPath);
    const repoNames = opts.repo ? [opts.repo] : Object.keys(config.repos);

    if (repoNames.length === 0) {
      console.log("No repos configured.");
      return;
    }

    const prefix = opts.dryRun ? "[dry-run] " : "";
    for (const repoName of repoNames) {
      await runInstallInstructionsForRepo(repoName, config, opts, prefix);
    }
  });

program
  .command("mcp-install")
  .description("Add the repo-expert MCP server entry to Claude Code config")
  .option("--global", "Write to global ~/.claude.json (default)")
  .option("--local", "Write to local ./.claude.json")
  .option("--config <path>", "Config file path", "config.yaml")
  .action(async (opts: McpInstallOpts) => {
    if (opts.global && opts.local) {
      console.error("Choose either --global or --local, not both.");
      process.exitCode = 1;
      return;
    }

    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const home = os.default.homedir();
    const configFile = opts.local ? path.resolve(".claude.json") : path.join(home, ".claude.json");

    let config: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(configFile, "utf8");
      try {
        config = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        throw new CliUserError(`Failed to parse ${configFile}: invalid JSON.`);
      }
    } catch (error) {
      if (error instanceof CliUserError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const mcpServers = (config["mcpServers"] ?? {}) as Record<string, unknown>;
    if (mcpServers[MCP_ENTRY_NAME]) {
      console.log(`Existing '${MCP_ENTRY_NAME}' entry found — overwriting.`);
    }

    const launch = await resolveMcpLaunch();
    if (launch.kind === "sea-binary") console.log(`Using SEA binary: ${launch.binaryPath}`);
    const repoConfig = await loadOptionalConfig(path.resolve(opts.config));
    const { providerConfig, warnings } = resolveMcpProviderConfig(repoConfig);
    const entry = generateMcpEntry(launch, providerConfig);
    mcpServers[MCP_ENTRY_NAME] = entry;
    config["mcpServers"] = mcpServers;

    await fs.writeFile(configFile, JSON.stringify(config, null, 2) + "\n", "utf8");
    console.log(`MCP entry written to ${configFile}`);
    if (warnings.length > 0) {
      console.log("Warnings:");
      for (const warning of warnings) {
        console.log(`  - ${warning}`);
      }
    }
    console.log("Restart Claude Code to pick up the change.");
    console.log('Tip: run "repo-expert install-instructions" to point Claude Code at these tools from CLAUDE.md/AGENTS.md.');
  });

program
  .command("mcp-check")
  .description("Validate existing MCP server entry in Claude Code config")
  .option("--json", "Output check result as JSON")
  .option("--config <path>", "Config file path", "config.yaml")
  .action(async (opts: McpCheckOpts) => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const home = os.default.homedir();
    const configFile = path.join(home, ".claude.json");

    const rawConfig = await fs.readFile(configFile, "utf8").catch((error: unknown) => {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        console.error(`Config file not found: ${configFile}`);
        process.exitCode = 1;
        return;
      }
      throw error;
    });
    if (rawConfig === undefined) return;
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(rawConfig) as Record<string, unknown>;
    } catch {
      console.error(`Failed to parse ${configFile}: invalid JSON.`);
      process.exitCode = 1;
      return;
    }

    const mcpServers = (config["mcpServers"] ?? {}) as Record<string, unknown>;
    const entry = mcpServers[MCP_ENTRY_NAME] as Parameters<typeof checkMcpEntry>[0];
    const launch = await resolveMcpLaunch();
    const repoConfig = await loadOptionalConfig(path.resolve(opts.config));
    const { providerConfig, warnings } = resolveMcpProviderConfig(repoConfig);
    const result = checkMcpEntry(entry, launch, providerConfig);

    if (opts.json) {
      const payload = warnings.length > 0 ? { ...result, warnings } : result;
      console.log(JSON.stringify(payload, null, 2));
      if (!result.ok) process.exitCode = 1;
      return;
    }

    if (warnings.length > 0) {
      console.log("Warnings:");
      for (const warning of warnings) {
        console.log(`  - ${warning}`);
      }
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

program
  .command("completion <shell>")
  .description("Print shell completion script (bash, zsh, fish)")
  .option("--install-dir <path>", "Write script to directory instead of stdout")
  .action(async (shell: string, opts: CompletionOpts) => {
    if (shell !== "bash" && shell !== "zsh" && shell !== "fish") {
      console.error(`Unsupported shell "${shell}". Use one of: bash, zsh, fish.`);
      process.exitCode = 1;
      return;
    }

    const selectedShell = shell as CompletionShell;
    const script = generateCompletionScript(selectedShell, "repo-expert");

    if (!opts.installDir) {
      process.stdout.write(script);
      return;
    }

    const fs = await import("node:fs/promises");
    const installDir = path.resolve(opts.installDir);
    const fileName = completionFileName(selectedShell, "repo-expert");
    const targetPath = path.join(installDir, fileName);

    await fs.mkdir(installDir, { recursive: true });
    await fs.writeFile(targetPath, script, "utf8");
    console.log(`Completion script written to ${targetPath}`);
  });

export async function main(argv = process.argv): Promise<void> {
  await program.parseAsync(argv);
}

if (isMainModule(import.meta.url)) {
  // eslint-disable-next-line unicorn/prefer-top-level-await
  void main().catch((error: unknown) => {
    if (error instanceof CliUserError || error instanceof StateFileError) {
      console.error(error.message);
      process.exitCode = error instanceof CliUserError ? error.exitCode : 1;
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Unexpected error: ${message}`);
    console.error("Run with --debug for stack trace.");
    if (readDebugEnabled(process.argv) && error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exitCode = 1;
  });
}
/* eslint-enable max-lines */
