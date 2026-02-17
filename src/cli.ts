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
import { runAllChecks, runDoctorFixes } from "./shell/doctor.js";
import { formatEvalReport } from "./core/eval.js";
import { runEvalFromFile } from "./shell/eval-runner.js";
import { formatSelfChecks, runSelfChecks } from "./shell/self-check.js";
import { completionFileName, generateCompletionScript, type CompletionShell } from "./core/completion.js";
import { formatDoctorReport } from "./core/doctor.js";
import { ConfigError, formatConfigError } from "./core/config.js";
import { collectFiles } from "./shell/file-collector.js";
import { StateFileError, loadState, saveState } from "./shell/state-store.js";
import { createRepoAgent, loadPassages } from "./shell/agent-factory.js";
import { bootstrapAgent } from "./shell/bootstrap.js";
import type { AgentProvider, CreateAgentParams, SendMessageOptions } from "./shell/provider.js";
import { LettaProvider } from "./shell/letta-provider.js";
import { rawTextStrategy } from "./core/chunker.js";
import { shouldIncludeFile } from "./core/filter.js";
import { addAgentToState, removeAgentFromState, updateAgentField, updatePassageMap } from "./core/state.js";
import { syncRepo } from "./shell/sync.js";
import { getAgentStatus, getAgentStatusData } from "./shell/status.js";
import { exportAgent } from "./shell/export.js";
import { onboardAgent } from "./shell/onboard.js";
import { broadcastAsk } from "./shell/group-provider.js";
import { watchRepos } from "./shell/watch.js";
import { beginCommandTelemetry, endCommandTelemetry, recordCommandRetry } from "./shell/telemetry.js";
import { DEFAULT_WATCH_CONFIG } from "./core/watch.js";
import { generatePlist, PLIST_LABEL } from "./core/daemon.js";
import { generateMcpEntry, checkMcpEntry } from "./core/mcp-config.js";
import { buildPostSetupNextSteps, getSetupMode } from "./core/setup.js";
import type { AgentState, AppState, Config } from "./core/types.js";
import {
  ASK_DEFAULT_CACHE_TTL_MS,
  ASK_DEFAULT_FAST_TIMEOUT_MS,
  ASK_DEFAULT_TIMEOUT_MS,
  buildAskRoutePlan,
  parseAskRoutingMode,
  type AskRoutingMode,
} from "./core/ask-routing.js";
import { InMemoryAnswerCache, toModelCacheKey } from "./shell/answer-cache.js";

interface SetupOpts {
  repo?: string;
  config: string;
  resume?: boolean;
  reindex?: boolean;
  json?: boolean;
  loadRetries: string;
  bootstrapRetries: string;
  loadTimeoutMs: string;
  bootstrapTimeoutMs: string;
}

interface ProgramOpts {
  noInput?: boolean;
  debug?: boolean;
}

interface InitOpts {
  apiKey?: string;
  repoPath?: string;
  yes?: boolean;
}

interface DoctorOpts {
  config: string;
  json?: boolean;
  fix?: boolean;
}

interface SelfCheckOpts {
  json?: boolean;
}

interface AskOpts {
  all?: boolean;
  interactive?: boolean;
  timeout: string;
  routing?: string;
  fastModel?: string;
  askTimeoutMs?: string;
  maxSteps?: string;
  cache?: boolean;
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

interface EvalRunOpts {
  repo: string;
  file: string;
  json?: boolean;
  maxTasks: string;
  minPassRate: string;
  save?: string;
}

const STATE_FILE = ".repo-expert-state.json";
const askAnswerCache = new InMemoryAnswerCache(ASK_DEFAULT_CACHE_TTL_MS);

interface AskRuntimeSettings {
  routing: AskRoutingMode;
  fastModel?: string;
  askTimeoutMs: number;
  fastAskTimeoutMs: number;
  cacheTtlMs: number;
  maxSteps?: number;
  cacheEnabled: boolean;
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

function requireApiKey(): void {
  if (!process.env.LETTA_API_KEY) {
    throw new CliUserError('Missing LETTA_API_KEY.\nRun "repo-expert init" to configure, or add it to .env manually.');
  }
}

function createProvider(): LettaProvider {
  requireApiKey();
  return new LettaProvider(new Letta({ timeout: 5 * 60 * 1000 }));
}

class FakeProvider implements AgentProvider {
  private nextAgentId = 1;
  private nextPassageId = 1;
  private passagesByAgent: Record<string, { id: string; text: string }[]> = {};
  private blocksByAgent: Record<string, Record<string, { value: string; limit: number }>> = {};

  async createAgent(_params: CreateAgentParams): Promise<{ agentId: string }> {
    const agentId = `fake-agent-${this.nextAgentId++}`;
    this.passagesByAgent[agentId] = [];
    this.blocksByAgent[agentId] = {
      persona: { value: "fake", limit: 5000 },
      architecture: { value: "fake", limit: 5000 },
      conventions: { value: "fake", limit: 5000 },
    };
    return { agentId };
  }

  async deleteAgent(agentId: string): Promise<void> {
    delete this.passagesByAgent[agentId];
    delete this.blocksByAgent[agentId];
  }

  async storePassage(agentId: string, text: string): Promise<string> {
    const delayMs = parseInt(process.env.REPO_EXPERT_TEST_DELAY_STORE_MS ?? "0", 10);
    if (!Number.isNaN(delayMs) && delayMs > 0) {
      await delay(delayMs);
    }
    if (process.env.REPO_EXPERT_TEST_FAIL_LOAD_ONCE === "1") {
      process.env.REPO_EXPERT_TEST_FAIL_LOAD_ONCE = "0";
      throw new Error("simulated load failure");
    }
    if (!this.passagesByAgent[agentId]) this.passagesByAgent[agentId] = [];
    const id = `fake-passage-${this.nextPassageId++}`;
    this.passagesByAgent[agentId].push({ id, text });
    return id;
  }

  async deletePassage(agentId: string, passageId: string): Promise<void> {
    const list = this.passagesByAgent[agentId] ?? [];
    this.passagesByAgent[agentId] = list.filter((p) => p.id !== passageId);
  }

  async listPassages(agentId: string): Promise<Array<{ id: string; text: string }>> {
    return this.passagesByAgent[agentId] ?? [];
  }

  async getBlock(agentId: string, label: string): Promise<{ value: string; limit: number }> {
    return this.blocksByAgent[agentId]?.[label] ?? { value: "", limit: 5000 };
  }

  async sendMessage(_agentId: string, _content: string, _options?: SendMessageOptions): Promise<string> {
    const delayMs = parseInt(process.env.REPO_EXPERT_TEST_DELAY_BOOTSTRAP_MS ?? "0", 10);
    if (!Number.isNaN(delayMs) && delayMs > 0) {
      await delay(delayMs);
    }
    if (process.env.REPO_EXPERT_TEST_FAIL_BOOTSTRAP_ONCE === "1") {
      process.env.REPO_EXPERT_TEST_FAIL_BOOTSTRAP_ONCE = "0";
      throw new Error("simulated bootstrap failure");
    }
    return "ok";
  }
}

function createProviderForCommands(): AgentProvider {
  if (process.env.REPO_EXPERT_TEST_FAKE_PROVIDER === "1") {
    return new FakeProvider();
  }
  return createProvider();
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

function parseNonNegativeInt(value: string, fallback: number): number {
  const parsed = parseIntOrDefault(value, fallback);
  return parsed < 0 ? fallback : parsed;
}

function parseOptionalPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseOptionalMaxSteps(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function formatDurationMs(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
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
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
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
  onRetry: (message: string) => void = (message) => console.warn(message),
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const waitMs = 500 * Math.pow(2, attempt);
      recordCommandRetry();
      onRetry(`  ${label} failed (attempt ${attempt + 1}/${retries + 1}): ${(err as Error).message}. Retrying in ${waitMs}ms...`);
      await delay(waitMs);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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

async function loadAskConfigDefaults(configPath: string | undefined): Promise<{
  fastModel?: string;
  askTimeoutMs: number;
  fastAskTimeoutMs: number;
  cacheTtlMs: number;
}> {
  const defaults = {
    askTimeoutMs: ASK_DEFAULT_TIMEOUT_MS,
    fastAskTimeoutMs: ASK_DEFAULT_FAST_TIMEOUT_MS,
    cacheTtlMs: ASK_DEFAULT_CACHE_TTL_MS,
  };

  const resolvedPath = configPath ? path.resolve(configPath) : path.resolve("config.yaml");
  if (!configPath) {
    try {
      const fs = await import("fs/promises");
      await fs.access(resolvedPath);
    } catch {
      return defaults;
    }
  }

  const config = await loadConfigSafe(resolvedPath);
  return {
    fastModel: config.letta.fastModel,
    askTimeoutMs: config.defaults.askTimeoutMs ?? defaults.askTimeoutMs,
    fastAskTimeoutMs: config.defaults.fastAskTimeoutMs ?? defaults.fastAskTimeoutMs,
    cacheTtlMs: config.defaults.cacheTtlMs ?? defaults.cacheTtlMs,
  };
}

async function askAgent(
  provider: AgentProvider,
  agent: AgentState,
  question: string,
  settings: AskRuntimeSettings,
): Promise<string> {
  const plan = buildAskRoutePlan({
    routing: settings.routing,
    question,
    fastModel: settings.fastModel,
    askTimeoutMs: settings.askTimeoutMs,
    fastAskTimeoutMs: settings.fastAskTimeoutMs,
  });

  const attempts: Array<{ overrideModel?: string; timeoutMs: number }> = [
    { overrideModel: plan.primaryOverrideModel, timeoutMs: plan.primaryTimeoutMs },
  ];
  if (plan.enableFallback) {
    attempts.push({
      overrideModel: plan.fallbackOverrideModel,
      timeoutMs: plan.fallbackTimeoutMs,
    });
  }

  if (settings.cacheEnabled) {
    for (const attempt of attempts) {
      const cached = askAnswerCache.get({
        agentId: agent.agentId,
        question,
        modelKey: toModelCacheKey(attempt.overrideModel),
        lastSyncCommit: agent.lastSyncCommit,
      });
      if (cached !== null) {
        return cached;
      }
    }
  }

  const runAttempt = async (attempt: { overrideModel?: string; timeoutMs: number }): Promise<string> => {
    const modelLabel = attempt.overrideModel ?? "agent-default";
    return withTimeout(
      `Ask "${agent.repoName}" (${modelLabel})`,
      attempt.timeoutMs,
      () => provider.sendMessage(agent.agentId, question, { overrideModel: attempt.overrideModel, maxSteps: settings.maxSteps }),
    );
  };

  let answer: string | null = null;
  let usedModel = attempts[0].overrideModel;
  let primaryError: unknown = null;

  try {
    answer = await runAttempt(attempts[0]);
  } catch (err) {
    primaryError = err;
  }

  const hasFallback = attempts.length > 1;
  const shouldFallback = hasFallback && (primaryError !== null || (answer ?? "").trim().length === 0);

  if (shouldFallback) {
    answer = await runAttempt(attempts[1]);
    usedModel = attempts[1].overrideModel;
  } else if (primaryError !== null) {
    throw primaryError;
  }

  const finalAnswer = answer ?? "";
  if (settings.cacheEnabled && finalAnswer.trim().length > 0) {
    askAnswerCache.set(
      {
        agentId: agent.agentId,
        question,
        modelKey: toModelCacheKey(usedModel),
        lastSyncCommit: agent.lastSyncCommit,
      },
      finalAnswer,
      settings.cacheTtlMs,
    );
  }

  return finalAnswer;
}

// --- Program ---

const program = new Command();
program.name("repo-expert").description("Persistent AI agents for git repositories").version("0.1.0");
program.option("--no-input", "Disable interactive prompts").option("--debug", "Show stack traces for unexpected errors");
program.hook("preAction", (_thisCommand, actionCommand) => {
  beginCommandTelemetry(actionCommand.name());
});
program.hook("postAction", () => {
  endCommandTelemetry(process.exitCode && process.exitCode !== 0 ? "error" : "ok");
});
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
  .option("--api-key <key>", "API key to write to .env (non-interactive)")
  .option("--repo-path <path>", "Repository path to configure")
  .option("-y, --yes", "Accept defaults and skip confirmation prompts")
  .action(async (opts: InitOpts) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      await runInit(rl, {
        apiKey: opts.apiKey,
        repoPath: opts.repoPath,
        assumeYes: Boolean(opts.yes),
        allowPrompts: !noInputEnabled() && interactiveInputAvailable(),
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
    if (process.env.LETTA_API_KEY) {
      provider = createProviderForCommands();
    }
    const results = await runAllChecks(provider, configPath);
    if (opts.json) {
      console.log(JSON.stringify({ fixes: fixed, checks: results }, null, 2));
    } else {
      console.log(formatDoctorReport(results));
    }
    const hasFailures = results.some((r) => r.status === "fail");
    if (hasFailures) process.exitCode = 1;
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
  .option("--json", "Output setup results as JSON")
  .option("--load-retries <n>", "Retries for passage loading", "2")
  .option("--bootstrap-retries <n>", "Retries for bootstrap stage", "2")
  .option("--load-timeout-ms <ms>", "Timeout for passage loading stage", "300000")
  .option("--bootstrap-timeout-ms <ms>", "Timeout for bootstrap stage", "120000")
  .action(async (opts: SetupOpts) => {
    if (opts.resume && opts.reindex) {
      console.error("Choose either --resume or --reindex, not both.");
      process.exitCode = 1;
      return;
    }

    const log = opts.json ? (_: string) => {} : (line: string) => console.log(line);
    const warn = opts.json ? (_: string) => {} : (line: string) => console.warn(line);
    const loadRetries = parseNonNegativeInt(opts.loadRetries, 2);
    const bootstrapRetries = parseNonNegativeInt(opts.bootstrapRetries, 2);
    const loadTimeoutMs = parseNonNegativeInt(opts.loadTimeoutMs, 300_000);
    const bootstrapTimeoutMs = parseNonNegativeInt(opts.bootstrapTimeoutMs, 120_000);

    const configPath = path.resolve(opts.config);
    const config = await loadConfigSafe(configPath);
    const provider = createProviderForCommands();
    let state = await loadState(STATE_FILE);

    const repoNames = opts.repo ? [opts.repo] : Object.keys(config.repos);
    const setupResults: Array<Record<string, unknown>> = [];

    for (const repoName of repoNames) {
      const repoStart = Date.now();
      const repoConfig = config.repos[repoName];
      if (!repoConfig) {
        const message = `Repo "${repoName}" not found in config`;
        console.error(message);
        setupResults.push({ repoName, status: "error", error: message, totalMs: Date.now() - repoStart });
        process.exitCode = 1;
        continue;
      }

      const existingAgent = state.agents[repoName];
      const mode = getSetupMode(existingAgent, repoConfig.bootstrapOnCreate, {
        forceResume: Boolean(opts.resume),
        forceReindex: Boolean(opts.reindex),
      });

      if (mode === "skip") {
        log(`Agent for "${repoName}" already exists (${existingAgent!.agentId}), skipping`);
        setupResults.push({
          repoName,
          status: "skipped",
          mode,
          agentId: existingAgent!.agentId,
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
          const agentState = await createRepoAgent(provider, repoName, repoConfig, config.letta);
          agentId = agentState.agentId;
          createMs = Date.now() - createStart;
          log(`  Agent created: ${agentId} (${formatDurationMs(createMs)})`);
          state = addAgentToState(state, repoName, agentId, new Date().toISOString());
          await saveState(STATE_FILE, state);
        } else {
          agentId = existingAgent!.agentId;
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
          log(`  Found ${files.length} files`);

          const chunks = files.flatMap((f) => rawTextStrategy(f));
          chunksLoaded = chunks.length;
          log(`  Loading ${chunks.length} passages...`);
          const passageMap = await withRetry(
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
          state = updatePassageMap(state, repoName, passageMap);
          await saveState(STATE_FILE, state);
          indexMs = Date.now() - indexStart;
          log(`  Index phase completed in ${formatDurationMs(indexMs)}.`);
        }

        // Store HEAD commit so incremental sync works immediately
        const headCommit = gitHeadCommit(repoConfig.path);
        if (headCommit) {
          state = updateAgentField(state, repoName, { lastSyncCommit: headCommit });
          await saveState(STATE_FILE, state);
        }

        if (repoConfig.bootstrapOnCreate && (mode === "create" || mode === "resume_full" || mode === "resume_bootstrap" || mode === "reindex_full")) {
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
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
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
        console.log(`Config OK: ${summary.repoCount} repo(s) in ${configPath}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, configPath, issues: [message] }, null, 2));
      } else {
        console.error(message);
      }
      process.exitCode = 1;
    }
  });

const evalCommand = program.command("eval").description("Personal benchmark evaluation helpers");

evalCommand
  .command("run")
  .description("Run benchmark tasks against one configured agent")
  .requiredOption("--repo <name>", "Repo name to evaluate")
  .option("--file <path>", "Task file path", "eval/tasks.json")
  .option("--json", "Output evaluation report as JSON")
  .option("--max-tasks <n>", "Limit how many tasks to run", "-1")
  .option("--min-pass-rate <n>", "Set failing threshold for overall pass rate (0-100)", "0")
  .option("--save <path>", "Write full JSON result to a file")
  .action(async (opts: EvalRunOpts) => {
    const state = await loadState(STATE_FILE);
    const agent = requireAgent(state, opts.repo);
    if (!agent) return;

    const provider = createProviderForCommands();
    const filePath = path.resolve(opts.file);
    const maxTasks = parseIntOrDefault(opts.maxTasks, -1);
    const minPassRate = parseNonNegativeInt(opts.minPassRate, 0);
    const run = await runEvalFromFile({
      provider,
      agentId: agent.agentId,
      filePath,
      maxTasks: maxTasks < 0 ? undefined : maxTasks,
    });

    if (opts.save) {
      const fs = await import("fs/promises");
      const savePath = path.resolve(opts.save);
      await fs.mkdir(path.dirname(savePath), { recursive: true });
      await fs.writeFile(savePath, JSON.stringify(run, null, 2), "utf-8");
    }

    if (opts.json) {
      console.log(JSON.stringify(run, null, 2));
    } else {
      console.log(formatEvalReport(run));
    }

    if (run.summary.overallPassRate < minPassRate) {
      process.exitCode = 1;
    }
  });

program
  .command("ask [repo] [question]")
  .description("Ask an agent a question")
  .option("--all", "Ask all agents and collect responses")
  .option("-i, --interactive", "Interactive REPL mode")
  .option("--timeout <ms>", "Per-agent timeout for --all (ms)", "30000")
  .option("--routing <mode>", "Routing mode for single-agent asks: auto|quality|speed", "auto")
  .option("--fast-model <model>", "Fast model handle used by routing=auto|speed")
  .option("--ask-timeout-ms <ms>", "Timeout for single-agent asks and interactive mode")
  .option("--max-steps <n>", "Maximum agent reasoning/tool steps per ask")
  .option("--no-cache", "Disable in-memory answer cache for single-agent asks")
  .option("--config <path>", "Optional config file path used for ask defaults")
  .action(async (repo: string | undefined, question: string | undefined, opts: AskOpts) => {
    const buildAskSettings = async (): Promise<AskRuntimeSettings> => {
      const configDefaults = await loadAskConfigDefaults(opts.config);
      let routing: AskRoutingMode;
      try {
        routing = parseAskRoutingMode(opts.routing);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new CliUserError(message);
      }
      return {
        routing,
        fastModel: opts.fastModel ?? configDefaults.fastModel,
        askTimeoutMs: parseOptionalPositiveInt(opts.askTimeoutMs, configDefaults.askTimeoutMs),
        fastAskTimeoutMs: configDefaults.fastAskTimeoutMs,
        cacheTtlMs: configDefaults.cacheTtlMs,
        maxSteps: parseOptionalMaxSteps(opts.maxSteps),
        cacheEnabled: opts.cache !== false,
      };
    };

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
      const askSettings = await buildAskSettings();

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

          const answer = await askAgent(provider, agentInfo, q, askSettings);
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
    const askSettings = await buildAskSettings();
    const answer = await askAgent(provider, agentInfo, question, askSettings);
    console.log(answer);
  });

program
  .command("sync")
  .description("Sync file changes to agents")
  .option("--repo <name>", "Sync a single repo")
  .option("--full", "Full re-index instead of incremental")
  .option("--since <ref>", "Git ref to diff from (overrides stored commit)")
  .option("--config <path>", "Config file path", "config.yaml")
  .option("--json", "Output sync results as JSON")
  .option("--dry-run", "Preview sync plan without writing state or calling Letta")
  .action(async (opts: SyncOpts) => {
    const log = opts.json ? (_: string) => {} : (line: string) => console.log(line);
    const configPath = path.resolve(opts.config);
    const config = await loadConfigSafe(configPath);
    const provider = opts.dryRun ? null : createProviderForCommands();
    let state = await loadState(STATE_FILE);
    const syncResults: Array<Record<string, unknown>> = [];

    const repoNames = opts.repo ? [opts.repo] : Object.keys(state.agents);

    for (const repoName of repoNames) {
      const agentInfo = requireAgent(state, repoName);
      if (!agentInfo) return;

      const repoConfig = config.repos[repoName];
      if (!repoConfig) {
        const message = `Repo "${repoName}" not found in config`;
        console.error(message);
        syncResults.push({ repoName, status: "error", error: message });
        process.exitCode = 1;
        continue;
      }

      const headCommit = gitHeadCommit(repoConfig.path);
      if (!headCommit && !(opts.dryRun && opts.full)) {
        const message = `"${repoName}": not a git repository or git is not available (${repoConfig.path})`;
        console.error(message);
        syncResults.push({ repoName, status: "error", error: message });
        process.exitCode = 1;
        continue;
      }

      let changedFiles: string[];
      if (opts.full) {
        const files = await collectFiles(repoConfig);
        changedFiles = files.map((f) => f.path);
        log(`Syncing "${repoName}" (full re-index, ${changedFiles.length} files)...`);
      } else {
        const sinceRef = opts.since ?? agentInfo.lastSyncCommit;
        if (!sinceRef) {
          log(`No previous sync for "${repoName}". Run "repo-expert sync --full" or re-run "repo-expert setup".`);
          syncResults.push({ repoName, status: "skipped", reason: "no_previous_sync" });
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
          const message = `"${repoName}": git diff failed. Is "${sinceRef}" a valid ref?`;
          console.error(message);
          syncResults.push({ repoName, status: "error", error: message });
          process.exitCode = 1;
          continue;
        }
        changedFiles = (diff ? diff.split("\n") : []).filter((f) => shouldIncludeFile(f, 0, repoConfig));
        log(`Syncing "${repoName}" (${changedFiles.length} changed files since ${sinceRef.slice(0, 7)})...`);
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
        log(`  Dry-run: would sync ${changedFiles.length} files.`);
        continue;
      }

      if (!headCommit) {
        const message = `"${repoName}": missing git HEAD commit`;
        console.error(message);
        syncResults.push({ repoName, status: "error", error: message });
        process.exitCode = 1;
        continue;
      }

      const result = await syncRepo({
        provider: provider!,
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
        maxFileSizeKb: repoConfig.maxFileSizeKb,
      });

      if (result.isFullReIndex) {
        log(`  Warning: ${changedFiles.length} files changed — consider --full re-index`);
      }

      log(`  Deleted: ${result.filesDeleted} files, Re-indexed: ${result.filesReIndexed} files`);

      state = updateAgentField(state, repoName, { passages: result.passages, lastSyncCommit: result.lastSyncCommit });
      await saveState(STATE_FILE, state);
      log(`  Done.`);
      syncResults.push({
        repoName,
        status: "ok",
        dryRun: false,
        changedFiles: changedFiles.length,
        filesDeleted: result.filesDeleted,
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
  .option("--json", "Output status as JSON")
  .action(async (opts: RepoOpts) => {
    const state = await loadState(STATE_FILE);
    const provider = createProviderForCommands();
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
  .option("--dry-run", "Preview agents that would be deleted")
  .action(async (opts: DestroyOpts) => {
    const state = await loadState(STATE_FILE);
    const repoNames = opts.repo ? [opts.repo] : Object.keys(state.agents);
    const existing = repoNames.filter((n) => state.agents[n]);

    if (existing.length === 0) {
      console.log("No agents to destroy.");
      return;
    }

    if (opts.dryRun) {
      console.log(`Dry-run: would delete ${existing.length} agent(s): ${existing.join(", ")}`);
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

    const provider = createProviderForCommands();

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
      if (!config.repos[name]) {
        console.error(`Repo "${name}" not found in config`);
        process.exitCode = 1;
        return;
      }
    }

    const intervalMs = Math.max(1, parseIntOrDefault(opts.interval, DEFAULT_WATCH_CONFIG.intervalMs / 1000)) * 1000;
    const debounceMs = Math.max(50, parseIntOrDefault(opts.debounce, DEFAULT_WATCH_CONFIG.debounceMs));
    const provider = createProvider();
    const ac = new AbortController();

    const shutdown = () => ac.abort();
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    console.log(
      `Watching ${repoNames.length} repo(s) (poll every ${intervalMs / 1000}s, debounce ${debounceMs}ms). Press Ctrl+C to stop.`,
    );

    await watchRepos({
      provider,
      config,
      repoNames,
      statePath: STATE_FILE,
      intervalMs,
      debounceMs,
      signal: ac.signal,
    });

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
      intervalSeconds: parseIntOrDefault(opts.interval, DEFAULT_WATCH_CONFIG.intervalMs / 1000),
      debounceMs: Math.max(50, parseIntOrDefault(opts.debounce, DEFAULT_WATCH_CONFIG.debounceMs)),
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

interface CompletionOpts {
  installDir?: string;
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

    const fs = await import("fs/promises");
    const installDir = path.resolve(opts.installDir);
    const fileName = completionFileName(selectedShell, "repo-expert");
    const targetPath = path.join(installDir, fileName);

    await fs.mkdir(installDir, { recursive: true });
    await fs.writeFile(targetPath, script, "utf-8");
    console.log(`Completion script written to ${targetPath}`);
  });

async function main(argv = process.argv): Promise<void> {
  await program.parseAsync(argv);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    const errorClass = err instanceof Error ? err.name : "UnknownError";
    endCommandTelemetry("error", errorClass);
    if (err instanceof CliUserError || err instanceof StateFileError) {
      console.error(err.message);
      process.exitCode = err instanceof CliUserError ? err.exitCode : 1;
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
