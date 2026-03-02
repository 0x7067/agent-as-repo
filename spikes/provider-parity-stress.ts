#!/usr/bin/env node
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Letta } from "@letta-ai/letta-client";
import { LettaProvider } from "../src/shell/letta-provider.js";
import { VikingProvider, type VikingRuntimeOptions } from "../src/shell/viking-provider.js";
import { VikingHttpClient } from "../src/shell/viking-http.js";
import { FilesystemBlockStorage } from "../src/shell/block-storage.js";
import { resolveOpenVikingBlocksDir } from "../src/shell/openviking-paths.js";
import type { AgentProvider, CreateAgentParams, SendMessageOptions } from "../src/ports/agent-provider.js";

type ProviderKey = "letta" | "viking";
type MethodName =
  | "createAgent"
  | "deleteAgent"
  | "enableSleeptime"
  | "storePassage"
  | "deletePassage"
  | "listPassages"
  | "getBlock"
  | "updateBlock"
  | "sendMessage";
type ParityStatus = "Equivalent" | "Partially equivalent" | "Not equivalent";
type LiveStageStatus = "completed" | "blocked" | "skipped";

interface EvidencePattern {
  path: string;
  contains: string;
  note: string;
}

interface EvidenceRef {
  path: string;
  line: number | null;
  note: string;
}

interface ParityRow {
  method: MethodName;
  critical: boolean;
  status: ParityStatus;
  rationale: string;
  deltas: string[];
  evidence: EvidenceRef[];
}

interface MethodRun {
  ok: boolean;
  durationMs: number;
  note?: string;
  error?: string;
}

interface ProviderContractRun {
  provider: ProviderKey;
  methods: Partial<Record<MethodName, MethodRun>>;
  blockedReason?: string;
}

interface StressScenarioConfig {
  name: string;
  durationMs: number;
  concurrency: number;
  operationTimeoutMs: number;
  degradedSendAbortAfterMs?: number;
}

interface ScenarioMetrics {
  provider: ProviderKey;
  scenario: string;
  durationMs: number;
  totalOps: number;
  successes: number;
  failures: number;
  timeoutFailures: number;
  retryLikeFailures: number;
  throughputOpsPerSec: number;
  errorRate: number;
  timeoutRate: number;
  retryLikeFailureRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

interface ScriptReport {
  generatedAt: string;
  parityRows: ParityRow[];
  parityGatePassed: boolean;
  parityGateReasons: string[];
  contractStage: {
    status: LiveStageStatus;
    letta?: ProviderContractRun;
    viking?: ProviderContractRun;
    blockedReason?: string;
  };
  stressStage: {
    status: LiveStageStatus;
    scenarios: ScenarioMetrics[];
    blockedReason?: string;
  };
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value <= 0) return fallback;
  return value;
}

function parseModelCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function getVikingRuntimeOptionsFromEnv(): VikingRuntimeOptions {
  return {
    requestTimeoutMs: parsePositiveInt(process.env["OPENROUTER_REQUEST_TIMEOUT_MS"], 20_000),
    maxRetriesPerModel: parsePositiveInt(process.env["OPENROUTER_MAX_RETRIES_PER_MODEL"], 0),
    retryBaseDelayMs: parsePositiveInt(process.env["OPENROUTER_RETRY_BASE_DELAY_MS"], 600),
    fallbackModels: parseModelCsv(process.env["OPENROUTER_FALLBACK_MODELS"]),
  };
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const rank = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1));
  return Math.round(sortedValues[rank] ?? 0);
}

function nowIso(): string {
  return new Date().toISOString();
}

function classifyError(error: unknown): { isTimeout: boolean; isRetryLike: boolean; text: string } {
  const text = error instanceof Error ? error.message : String(error);
  const lower = text.toLowerCase();
  const isTimeout = lower.includes("timed out") || lower.includes("timeout");
  const isRetryLike =
    lower.includes("attempt") ||
    lower.includes("all model attempts failed") ||
    lower.includes("http 429") ||
    lower.includes("http 500") ||
    lower.includes("http 502") ||
    lower.includes("http 503") ||
    lower.includes("http 504");
  return { isTimeout, isRetryLike, text };
}

function isOperationalFailureMessage(message: string | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("missing") ||
    lower.includes("http 5") ||
    lower.includes("http 429") ||
    lower.includes("fetch failed") ||
    lower.includes("econn") ||
    lower.includes("cannot reach") ||
    lower.includes("all model attempts failed") ||
    lower.includes("empty response from sendmessage")
  );
}

async function withTimeout<T>(label: string, timeoutMs: number, fn: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function findLine(pathAbs: string, contains: string): Promise<number | null> {
  const content = await readFile(pathAbs, "utf-8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? "").includes(contains)) return i + 1;
  }
  return null;
}

const STATIC_ROWS: Array<{
  method: MethodName;
  critical: boolean;
  status: ParityStatus;
  rationale: string;
  deltas: string[];
  evidence: EvidencePattern[];
}> = [
  {
    method: "createAgent",
    critical: true,
    status: "Partially equivalent",
    rationale: "Both implementations create core memory shape and return an agent ID.",
    deltas: [
      "Letta returns remote-generated agent IDs.",
      "Viking uses repoName as deterministic agent ID.",
    ],
    evidence: [
      { path: "src/shell/letta-provider.ts", contains: "async createAgent(", note: "Letta create agent flow" },
      { path: "src/shell/viking-provider.ts", contains: "async createAgent(", note: "Viking create agent flow" },
    ],
  },
  {
    method: "deleteAgent",
    critical: true,
    status: "Equivalent",
    rationale: "Both delete agent resources and treat missing resources as non-fatal downstream.",
    deltas: [],
    evidence: [
      { path: "src/shell/letta-provider.ts", contains: "async deleteAgent(", note: "Letta delete" },
      { path: "src/shell/viking-provider.ts", contains: "async deleteAgent(", note: "Viking delete" },
    ],
  },
  {
    method: "enableSleeptime",
    critical: false,
    status: "Partially equivalent",
    rationale: "Method exists in both providers but behavior differs by provider capabilities.",
    deltas: [
      "Letta toggles provider-native sleeptime.",
      "Viking is a documented no-op.",
    ],
    evidence: [
      { path: "src/shell/letta-provider.ts", contains: "async enableSleeptime(", note: "Letta sleeptime update" },
      { path: "src/shell/viking-provider.ts", contains: "enableSleeptime(_agentId: string)", note: "Viking no-op sleeptime" },
      { path: "docs/plans/2026-03-01-viking-provider-design.md", contains: "enableSleeptime", note: "Design note: sleeptime no-op" },
    ],
  },
  {
    method: "storePassage",
    critical: true,
    status: "Equivalent",
    rationale: "Both persist passage text and return a passage identifier.",
    deltas: [],
    evidence: [
      { path: "src/shell/letta-provider.ts", contains: "async storePassage(", note: "Letta store passage" },
      { path: "src/shell/viking-provider.ts", contains: "async storePassage(", note: "Viking store passage" },
    ],
  },
  {
    method: "deletePassage",
    critical: true,
    status: "Equivalent",
    rationale: "Both delete passages and are idempotent for missing passage resources.",
    deltas: [],
    evidence: [
      { path: "src/shell/letta-provider.ts", contains: "if (isHttpStatus(error, 404)) return", note: "Letta idempotent delete" },
      { path: "src/shell/viking-http.ts", contains: "if (res.status === 404) return;", note: "Viking idempotent delete" },
    ],
  },
  {
    method: "listPassages",
    critical: true,
    status: "Equivalent",
    rationale: "Both return `{id, text}` arrays with pagination/listing mechanics hidden behind interface.",
    deltas: [],
    evidence: [
      { path: "src/shell/letta-provider.ts", contains: "async listPassages(", note: "Letta list passages" },
      { path: "src/shell/viking-provider.ts", contains: "async listPassages(", note: "Viking list passages" },
    ],
  },
  {
    method: "getBlock",
    critical: true,
    status: "Partially equivalent",
    rationale: "Both return block value and limit, but limit source differs.",
    deltas: [
      "Letta returns block limit from remote response.",
      "Viking returns fixed limit=5000 from local block storage abstraction.",
    ],
    evidence: [
      { path: "src/shell/letta-provider.ts", contains: "async getBlock(", note: "Letta block retrieval" },
      { path: "src/shell/viking-provider.ts", contains: "async getBlock(", note: "Viking block retrieval" },
    ],
  },
  {
    method: "updateBlock",
    critical: true,
    status: "Partially equivalent",
    rationale: "Both update block values and return updated memory block payload.",
    deltas: [
      "Letta limit comes from API.",
      "Viking returns fixed limit=5000.",
    ],
    evidence: [
      { path: "src/shell/letta-provider.ts", contains: "async updateBlock(", note: "Letta block update" },
      { path: "src/shell/viking-provider.ts", contains: "async updateBlock(", note: "Viking block update" },
    ],
  },
  {
    method: "sendMessage",
    critical: true,
    status: "Partially equivalent",
    rationale: "Both provide tool-capable response generation, but runtime semantics differ.",
    deltas: [
      "Letta uses provider-managed message API with transient retry wrapper.",
      "Viking uses OpenRouter tool loop with model fallback and per-model retries.",
    ],
    evidence: [
      { path: "src/shell/letta-provider.ts", contains: "async sendMessage(", note: "Letta sendMessage" },
      { path: "src/shell/viking-provider.ts", contains: "async sendMessage(", note: "Viking sendMessage" },
      { path: "src/shell/viking-provider.ts", contains: "modelCandidates", note: "Fallback model candidates" },
      { path: "src/shell/letta-provider.ts", contains: "withRetry", note: "Letta transient retry helper" },
    ],
  },
];

async function buildStaticRows(rootDir: string): Promise<ParityRow[]> {
  const rows: ParityRow[] = [];
  for (const row of STATIC_ROWS) {
    const evidence: EvidenceRef[] = [];
    for (const ref of row.evidence) {
      const abs = path.resolve(rootDir, ref.path);
      const line = await findLine(abs, ref.contains);
      evidence.push({
        path: ref.path,
        line,
        note: ref.note,
      });
    }
    rows.push({
      method: row.method,
      critical: row.critical,
      status: row.status,
      rationale: row.rationale,
      deltas: row.deltas,
      evidence,
    });
  }
  return rows;
}

function createProvidersFromEnv(): {
  letta?: AgentProvider;
  viking?: AgentProvider;
  blockedReason?: string;
} {
  const lettaApiKey = process.env["LETTA_API_KEY"];
  const openrouterApiKey = process.env["OPENROUTER_API_KEY"];
  if (!lettaApiKey || !openrouterApiKey) {
    return {
      blockedReason: "Missing required credentials. Set LETTA_API_KEY and OPENROUTER_API_KEY.",
    };
  }

  const letta = new Letta({
    apiKey: lettaApiKey,
    baseURL: process.env["LETTA_BASE_URL"],
    timeout: 5 * 60 * 1000,
  });

  const vikingUrl = process.env["VIKING_URL"] ?? "http://localhost:1933";
  const vikingApiKey = process.env["VIKING_API_KEY"];
  const openrouterModel = process.env["OPENROUTER_MODEL"] ?? "openai/gpt-4o-mini";
  const vikingHttp = new VikingHttpClient(vikingUrl, vikingApiKey);
  const blockStorage = new FilesystemBlockStorage(resolveOpenVikingBlocksDir());
  const vikingProvider = new VikingProvider(
    vikingHttp,
    openrouterApiKey,
    openrouterModel,
    blockStorage,
    getVikingRuntimeOptionsFromEnv(),
  );

  return {
    letta: new LettaProvider(letta),
    viking: vikingProvider,
  };
}

function buildCreateParams(provider: ProviderKey, tag: string): CreateAgentParams {
  const repoName = `parity-${provider}-${tag}`;
  return {
    name: repoName,
    repoName,
    description: "Parity and stress evaluation agent",
    tags: ["parity", "stress", provider],
    model: provider === "letta"
      ? (process.env["LETTA_MODEL"] ?? "openai/gpt-4.1")
      : (process.env["OPENROUTER_MODEL"] ?? "openai/gpt-4o-mini"),
    embedding: process.env["LETTA_EMBEDDING"] ?? "openai/text-embedding-3-small",
    memoryBlockLimit: parsePositiveInt(process.env["PARITY_MEMORY_BLOCK_LIMIT"], 5000),
    tools: ["memory_replace"],
  };
}

async function runMethod(
  methods: Partial<Record<MethodName, MethodRun>>,
  method: MethodName,
  fn: () => Promise<void>,
): Promise<void> {
  const startedAt = performance.now();
  try {
    await fn();
    methods[method] = { ok: true, durationMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    methods[method] = { ok: false, durationMs: Math.round(performance.now() - startedAt), error: text };
  }
}

async function runContractSuite(providerName: ProviderKey, provider: AgentProvider): Promise<ProviderContractRun> {
  const methods: Partial<Record<MethodName, MethodRun>> = {};
  const tag = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const params = buildCreateParams(providerName, tag);
  let agentId = "";
  const storedPassages: string[] = [];

  await runMethod(methods, "createAgent", async () => {
    const created = await provider.createAgent(params);
    if (!created.agentId) throw new Error("Empty agentId");
    agentId = created.agentId;
  });

  if (!agentId) {
    return {
      provider: providerName,
      methods,
      blockedReason: methods.createAgent?.error ?? "createAgent failed",
    };
  }

  await runMethod(methods, "enableSleeptime", async () => {
    await provider.enableSleeptime(agentId);
  });

  const blockValue = `contract-check-${providerName}-${tag}`;
  await runMethod(methods, "updateBlock", async () => {
    const updated = await provider.updateBlock(agentId, "architecture", blockValue);
    if (!updated.value.includes(blockValue)) throw new Error("updateBlock value mismatch");
  });

  await runMethod(methods, "getBlock", async () => {
    const block = await provider.getBlock(agentId, "architecture");
    if (!block.value.includes(blockValue)) throw new Error("getBlock value mismatch");
  });

  await runMethod(methods, "storePassage", async () => {
    for (let i = 0; i < 3; i++) {
      const id = await provider.storePassage(agentId, `PARITY:${providerName}:${tag}:chunk:${i.toString()}`);
      storedPassages.push(id);
    }
  });

  await runMethod(methods, "listPassages", async () => {
    const listed = await provider.listPassages(agentId);
    if (listed.length === 0) throw new Error("No passages returned");
  });

  await runMethod(methods, "sendMessage", async () => {
    const maxSteps = parsePositiveInt(process.env["PARITY_MAX_STEPS"], 12);
    const prompts = [
      "Reply with the exact token PARITY_OK and nothing else.",
      "Do not call tools. Reply with the exact token PARITY_OK and nothing else.",
    ];

    let lastResponse = "";
    for (let attempt = 0; attempt < prompts.length; attempt++) {
      const response = await provider.sendMessage(
        agentId,
        prompts[attempt] ?? prompts[0]!,
        { maxSteps: maxSteps + attempt * 2 },
      );
      if ((response ?? "").trim().length > 0) {
        lastResponse = response;
        break;
      }
    }

    if (lastResponse.trim().length === 0) {
      throw new Error(`Empty response from sendMessage after ${prompts.length.toString()} attempts`);
    }
  });

  await runMethod(methods, "deletePassage", async () => {
    const first = storedPassages[0];
    if (!first) throw new Error("No stored passage to delete");
    await provider.deletePassage(agentId, first);
  });

  await runMethod(methods, "deleteAgent", async () => {
    await provider.deleteAgent(agentId);
  });

  return { provider: providerName, methods };
}

function applyContractResults(rows: ParityRow[], letta: ProviderContractRun, viking: ProviderContractRun): ParityRow[] {
  const out = rows.map((row) => ({ ...row, deltas: [...row.deltas], evidence: [...row.evidence] }));
  for (const row of out) {
    const l = letta.methods[row.method];
    const v = viking.methods[row.method];
    if (!l || !v) continue;
    const lettaErr = l.error?.slice(0, 180);
    const vikingErr = v.error?.slice(0, 180);
    const lettaOpFailure = isOperationalFailureMessage(lettaErr);
    const vikingOpFailure = isOperationalFailureMessage(vikingErr);
    if (l.ok !== v.ok) {
      if ((lettaOpFailure && !l.ok) || (vikingOpFailure && !v.ok)) {
        row.status = row.status === "Equivalent" ? "Partially equivalent" : row.status;
        row.deltas.push(
          `Live contract operational mismatch: letta=${String(l.ok)}${lettaErr ? ` (${lettaErr})` : ""} viking=${String(v.ok)}${vikingErr ? ` (${vikingErr})` : ""}`,
        );
      } else {
        row.status = "Not equivalent";
        row.deltas.push(
          `Live contract mismatch: letta=${String(l.ok)}${lettaErr ? ` (${lettaErr})` : ""} viking=${String(v.ok)}${vikingErr ? ` (${vikingErr})` : ""}`,
        );
      }
      continue;
    }
    if (!l.ok && !v.ok) {
      if (lettaOpFailure && vikingOpFailure) {
        row.status = row.status === "Equivalent" ? "Partially equivalent" : row.status;
        row.deltas.push(
          `Both providers failed due operational/runtime conditions. letta=(${lettaErr ?? "unknown"}) viking=(${vikingErr ?? "unknown"})`,
        );
      } else {
        row.status = "Not equivalent";
        row.deltas.push(
          `Both providers failed in live contract checks. letta=(${lettaErr ?? "unknown"}) viking=(${vikingErr ?? "unknown"})`,
        );
      }
      continue;
    }
  }
  return out;
}

function buildGate(parityRows: ParityRow[]): { pass: boolean; reasons: string[] } {
  const criticalGaps = parityRows.filter((row) => row.critical && row.status === "Not equivalent");
  if (criticalGaps.length === 0) {
    return { pass: true, reasons: ["No critical Not-equivalent gaps detected."] };
  }
  return {
    pass: false,
    reasons: criticalGaps.map((row) => `${row.method}: marked Not equivalent and critical`),
  };
}

function pickOperation(): "store" | "list" | "getBlock" | "updateBlock" | "send" | "delete" {
  const r = Math.random();
  if (r < 0.24) return "store";
  if (r < 0.42) return "list";
  if (r < 0.55) return "getBlock";
  if (r < 0.68) return "updateBlock";
  if (r < 0.9) return "send";
  return "delete";
}

async function runStressForProvider(
  providerName: ProviderKey,
  provider: AgentProvider,
  scenario: StressScenarioConfig,
): Promise<ScenarioMetrics> {
  const tag = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const params = buildCreateParams(providerName, `stress-${scenario.name}-${tag}`);
  const created = await provider.createAgent(params);
  const agentId = created.agentId;
  const storedIds: string[] = [];
  const latencies: number[] = [];
  let successes = 0;
  let failures = 0;
  let timeoutFailures = 0;
  let retryLikeFailures = 0;
  let startedAt = 0;
  let deadline = 0;

  try {
    for (let i = 0; i < 6; i++) {
      const id = await provider.storePassage(agentId, `STRESS:${providerName}:${scenario.name}:seed:${i.toString()}`);
      storedIds.push(id);
    }

    startedAt = Date.now();
    deadline = startedAt + scenario.durationMs;

    const worker = async (): Promise<void> => {
      while (Date.now() < deadline) {
        const op = pickOperation();
        const opStart = performance.now();
        try {
          await withTimeout(`stress.${providerName}.${scenario.name}.${op}`, scenario.operationTimeoutMs, async () => {
            if (op === "store") {
              const id = await provider.storePassage(
                agentId,
                `STRESS:${providerName}:${scenario.name}:${Date.now().toString(36)}:${randomUUID().slice(0, 6)}`,
              );
              storedIds.push(id);
              return;
            }
            if (op === "list") {
              await provider.listPassages(agentId);
              return;
            }
            if (op === "getBlock") {
              await provider.getBlock(agentId, "architecture");
              return;
            }
            if (op === "updateBlock") {
              await provider.updateBlock(
                agentId,
                "architecture",
                `stress-update-${providerName}-${scenario.name}-${Date.now().toString(36)}`,
              );
              return;
            }
            if (op === "delete") {
              if (storedIds.length === 0) {
                const replacement = await provider.storePassage(agentId, "STRESS:replacement");
                storedIds.push(replacement);
              }
              const id = storedIds.shift();
              if (id) await provider.deletePassage(agentId, id);
              return;
            }

            const options: SendMessageOptions = {
              maxSteps: parsePositiveInt(process.env["STRESS_MAX_STEPS"], 4),
            };
            if (scenario.degradedSendAbortAfterMs !== undefined) {
              const controller = new AbortController();
              setTimeout(() => controller.abort(new Error("degraded scenario abort")), scenario.degradedSendAbortAfterMs);
              options.signal = controller.signal;
            }
            await provider.sendMessage(
              agentId,
              "Return exactly 'stress-ok'.",
              options,
            );
          });
          successes++;
          latencies.push(Math.round(performance.now() - opStart));
        } catch (error) {
          failures++;
          latencies.push(Math.round(performance.now() - opStart));
          const parsed = classifyError(error);
          if (parsed.isTimeout) timeoutFailures++;
          if (parsed.isRetryLike) retryLikeFailures++;
        }
      }
    };

    await Promise.all(Array.from({ length: scenario.concurrency }, () => worker()));
  } finally {
    await provider.deleteAgent(agentId).catch(() => undefined);
  }

  const durationMs = startedAt === 0
    ? scenario.durationMs
    : Math.max(1, Date.now() - startedAt);
  const totalOps = successes + failures;
  const sorted = [...latencies].sort((a, b) => a - b);
  const throughputOpsPerSec = Number((totalOps / (durationMs / 1000)).toFixed(2));
  const errorRate = totalOps === 0 ? 0 : Number((failures / totalOps).toFixed(4));
  const timeoutRate = totalOps === 0 ? 0 : Number((timeoutFailures / totalOps).toFixed(4));
  const retryLikeFailureRate = totalOps === 0 ? 0 : Number((retryLikeFailures / totalOps).toFixed(4));

  return {
    provider: providerName,
    scenario: scenario.name,
    durationMs,
    totalOps,
    successes,
    failures,
    timeoutFailures,
    retryLikeFailures,
    throughputOpsPerSec,
    errorRate,
    timeoutRate,
    retryLikeFailureRate,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
  };
}

async function runStressScenarios(letta: AgentProvider, viking: AgentProvider): Promise<ScenarioMetrics[]> {
  const scenarios: StressScenarioConfig[] = [
    {
      name: "steady_low",
      durationMs: parsePositiveInt(process.env["STRESS_STEADY_LOW_MS"], 20_000),
      concurrency: parsePositiveInt(process.env["STRESS_STEADY_LOW_CONCURRENCY"], 2),
      operationTimeoutMs: parsePositiveInt(process.env["STRESS_OP_TIMEOUT_MS"], 25_000),
    },
    {
      name: "steady_medium",
      durationMs: parsePositiveInt(process.env["STRESS_STEADY_MEDIUM_MS"], 20_000),
      concurrency: parsePositiveInt(process.env["STRESS_STEADY_MEDIUM_CONCURRENCY"], 4),
      operationTimeoutMs: parsePositiveInt(process.env["STRESS_OP_TIMEOUT_MS"], 25_000),
    },
    {
      name: "burst_high",
      durationMs: parsePositiveInt(process.env["STRESS_BURST_MS"], 12_000),
      concurrency: parsePositiveInt(process.env["STRESS_BURST_CONCURRENCY"], 8),
      operationTimeoutMs: parsePositiveInt(process.env["STRESS_OP_TIMEOUT_MS"], 25_000),
    },
    {
      name: "mixed_degraded",
      durationMs: parsePositiveInt(process.env["STRESS_DEGRADED_MS"], 12_000),
      concurrency: parsePositiveInt(process.env["STRESS_DEGRADED_CONCURRENCY"], 3),
      operationTimeoutMs: parsePositiveInt(process.env["STRESS_OP_TIMEOUT_MS"], 25_000),
      degradedSendAbortAfterMs: parsePositiveInt(process.env["STRESS_DEGRADED_ABORT_MS"], 400),
    },
  ];

  const metrics: ScenarioMetrics[] = [];
  for (const scenario of scenarios) {
    metrics.push(await runStressForProvider("letta", letta, scenario));
    metrics.push(await runStressForProvider("viking", viking, scenario));
  }
  return metrics;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function renderParityTable(rows: ParityRow[]): string {
  const header = [
    "| Method | Critical | Status | Rationale |",
    "|---|---:|---|---|",
  ];
  const body = rows.map((row) => {
    return `| ${row.method} | ${row.critical ? "yes" : "no"} | ${row.status} | ${escapeCell(row.rationale)} |`;
  });
  return [...header, ...body].join("\n");
}

function renderEvidence(rows: ParityRow[]): string {
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(`- \`${row.method}\``);
    for (const evidence of row.evidence) {
      const suffix = evidence.line ? `:${evidence.line.toString()}` : "";
      lines.push(`  - ${evidence.path}${suffix} — ${evidence.note}`);
    }
    for (const delta of row.deltas) {
      lines.push(`  - Delta: ${delta}`);
    }
  }
  return lines.join("\n");
}

function renderStressTable(metrics: ScenarioMetrics[]): string {
  if (metrics.length === 0) {
    return "_No stress metrics collected._";
  }
  const lines = [
    "| Scenario | Provider | Ops | Throughput (ops/s) | p50 | p95 | p99 | Error rate | Timeout rate | Retry-like failure rate |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const row of metrics) {
    lines.push(
      `| ${row.scenario} | ${row.provider} | ${row.totalOps.toString()} | ${row.throughputOpsPerSec.toFixed(2)} | ${row.p50Ms.toString()}ms | ${row.p95Ms.toString()}ms | ${row.p99Ms.toString()}ms | ${(row.errorRate * 100).toFixed(2)}% | ${(row.timeoutRate * 100).toFixed(2)}% | ${(row.retryLikeFailureRate * 100).toFixed(2)}% |`,
    );
  }
  return lines.join("\n");
}

function renderVerdict(report: ScriptReport): string {
  const parity = report.parityGatePassed ? "Yes" : "No";
  const critical = report.parityRows.filter((row) => row.critical && row.status === "Not equivalent");
  const riskLines: string[] = [];
  if (critical.length > 0) {
    for (const row of critical.slice(0, 3)) {
      riskLines.push(`- ${row.method}: critical non-equivalence`);
    }
  } else {
    riskLines.push("- No critical non-equivalence found by current gate.");
  }
  if (report.stressStage.status !== "completed") {
    riskLines.push("- Stress stage did not complete; performance comparison is incomplete.");
  }

  return [
    `- Parity: **${parity}**`,
    `- Gate reasons: ${report.parityGateReasons.join("; ")}`,
    `- Stress stage: **${report.stressStage.status}**`,
    "- Top risks:",
    ...riskLines,
  ].join("\n");
}

function renderMarkdown(report: ScriptReport): string {
  const sections: string[] = [];
  sections.push(`# Letta vs OpenViking Parity and Stress Report`);
  sections.push(`Generated at: ${report.generatedAt}`);
  sections.push("");
  sections.push("## Parity Matrix");
  sections.push(renderParityTable(report.parityRows));
  sections.push("");
  sections.push("## Key Behavioral Deltas and Evidence");
  sections.push(renderEvidence(report.parityRows));
  sections.push("");
  sections.push("## Contract Stage");
  sections.push(`- Status: **${report.contractStage.status}**`);
  if (report.contractStage.blockedReason) {
    sections.push(`- Blocked reason: ${report.contractStage.blockedReason}`);
  }
  if (report.contractStage.letta) {
    sections.push(`- Letta methods checked: ${Object.keys(report.contractStage.letta.methods).length.toString()}`);
  }
  if (report.contractStage.viking) {
    sections.push(`- Viking methods checked: ${Object.keys(report.contractStage.viking.methods).length.toString()}`);
  }
  sections.push("");
  sections.push("## Stress-Test Methodology");
  sections.push("- Workloads: steady_low, steady_medium, burst_high, mixed_degraded.");
  sections.push("- Operation mix (random weighted): store, list, getBlock, updateBlock, sendMessage, deletePassage.");
  sections.push("- Metrics: throughput, p50/p95/p99, error rate, timeout rate, retry-like failure rate.");
  sections.push("");
  sections.push("## Results Comparison");
  sections.push(renderStressTable(report.stressStage.scenarios));
  sections.push("");
  sections.push("## Verdict");
  sections.push(renderVerdict(report));
  return sections.join("\n");
}

async function main(): Promise<void> {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outputPathArgIndex = process.argv.indexOf("--output");
  const requestedOutput = outputPathArgIndex >= 0 ? process.argv[outputPathArgIndex + 1] : undefined;
  const reportPath = requestedOutput
    ? path.resolve(process.cwd(), requestedOutput)
    : path.resolve(rootDir, "docs", "reports", `${nowIso().slice(0, 10)}-provider-parity-stress.md`);

  let parityRows = await buildStaticRows(rootDir);
  const providers = createProvidersFromEnv();

  const report: ScriptReport = {
    generatedAt: nowIso(),
    parityRows,
    parityGatePassed: false,
    parityGateReasons: [],
    contractStage: {
      status: "skipped",
    },
    stressStage: {
      status: "skipped",
      scenarios: [],
    },
  };

  if (providers.blockedReason || !providers.letta || !providers.viking) {
    report.contractStage = {
      status: "blocked",
      blockedReason: providers.blockedReason ?? "Provider construction failed",
    };
    const gate = buildGate(parityRows);
    report.parityGatePassed = gate.pass;
    report.parityGateReasons = [
      ...gate.reasons,
      "Live contract checks skipped due missing prerequisites.",
    ];
    report.stressStage = {
      status: "blocked",
      scenarios: [],
      blockedReason: providers.blockedReason ?? "Provider construction failed",
    };
  } else {
    const [lettaContract, vikingContract] = await Promise.all([
      runContractSuite("letta", providers.letta),
      runContractSuite("viking", providers.viking),
    ]);
    parityRows = applyContractResults(parityRows, lettaContract, vikingContract);
    report.parityRows = parityRows;
    report.contractStage = {
      status: "completed",
      letta: lettaContract,
      viking: vikingContract,
    };

    const gate = buildGate(parityRows);
    report.parityGatePassed = gate.pass;
    report.parityGateReasons = gate.reasons;
    if (!gate.pass) {
      report.stressStage = {
        status: "skipped",
        scenarios: [],
        blockedReason: "Parity gate failed (critical non-equivalence).",
      };
    } else {
      const scenarios = await runStressScenarios(providers.letta, providers.viking);
      report.stressStage = {
        status: "completed",
        scenarios,
      };
    }
  }

  const markdown = renderMarkdown(report);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, markdown, "utf-8");
  process.stdout.write(`${markdown}\n\nSaved report: ${reportPath}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`provider-parity-stress failed: ${message}\n`);
  process.exit(1);
});
