import { randomUUID } from "node:crypto";
import { agenticSearchGuidance, buildPersona } from "../core/prompts.js";
import type {
  AgentProvider,
  CreateAgentParams,
  CreateAgentResult,
  Passage,
  MemoryBlock,
  SendMessageOptions,
  ConsolidateMemoryOptions,
} from "../ports/agent-provider.js";
import type { PassageStore } from "../ports/passage-store.js";
import type { RepoAccessPort } from "../ports/repo-access.js";
import { toolCallingLoop, DEFAULT_LLM_BASE_URL, type ToolDefinition, type ToolHandler } from "./llm-client.js";
import type { BlockStorage } from "./block-storage.js";
import { buildAskTools, CONSOLIDATION_MEMORY_REPLACE_TOOL, type SymbolLookupPort } from "./agent-tools.js";

export interface LocalRuntimeOptions {
  baseUrl?: string;
  apiKey?: string;
  fallbackModels?: string[];
  requestTimeoutMs?: number;
  maxRetriesPerModel?: number;
  retryBaseDelayMs?: number;
  /**
   * When true (standalone CLI ask), expose grep_repo / glob_files / read_file / find_symbol.
   * MCP / coding-harness surfaces leave this false — the host already has filesystem tools.
   */
  agenticTools?: boolean;
  /** Live-repo access required when agenticTools is enabled. */
  repoAccess?: RepoAccessPort;
  /** Ranked symbol lookup from sync-time symbolFiles (CLI ask only). */
  symbolLookup?: SymbolLookupPort;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES_PER_MODEL = 1;
const DEFAULT_RETRY_BASE_DELAY_MS = 600;

function isAbortLikeError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("abort");
  }
  return false;
}

function isRetryableModelError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("timed out") ||
    message.includes("http 429") ||
    message.includes("http 500") ||
    message.includes("http 502") ||
    message.includes("http 503") ||
    message.includes("http 504") ||
    message.includes("ecconn") ||
    message.includes("fetch failed")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unknownToMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (value === null || value === undefined) return "";
  try {
    const encoded = JSON.stringify(value);
    return encoded;
  } catch {
    return "";
  }
}

export class LocalProvider implements AgentProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fallbackModels: string[];
  private readonly requestTimeoutMs: number;
  private readonly maxRetriesPerModel: number;
  private readonly retryBaseDelayMs: number;
  private readonly agenticTools: boolean;
  private readonly repoAccess: RepoAccessPort | undefined;
  private readonly symbolLookup: SymbolLookupPort | undefined;

  constructor(
    private store: PassageStore,
    private model: string,
    private blockStorage: BlockStorage,
    runtimeOptions: LocalRuntimeOptions = {},
  ) {
    this.baseUrl = runtimeOptions.baseUrl ?? DEFAULT_LLM_BASE_URL;
    this.apiKey = runtimeOptions.apiKey;
    this.fallbackModels = runtimeOptions.fallbackModels ?? [];
    this.requestTimeoutMs = runtimeOptions.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxRetriesPerModel = runtimeOptions.maxRetriesPerModel ?? DEFAULT_MAX_RETRIES_PER_MODEL;
    this.retryBaseDelayMs = runtimeOptions.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.agenticTools = runtimeOptions.agenticTools === true;
    this.repoAccess = runtimeOptions.repoAccess;
    this.symbolLookup = runtimeOptions.symbolLookup;
  }

  async createAgent(params: CreateAgentParams): Promise<CreateAgentResult> {
    const { repoName } = params;
    const persona = buildPersona(repoName, params.description, params.persona);

    await this.store.initAgent(repoName, {
      agentId: repoName,
      name: params.name,
      model: params.model,
      tags: ["repo-expert"],
      createdAt: new Date().toISOString(),
    });

    this.blockStorage.init(repoName, {
      persona,
      architecture: "Not yet analyzed.",
      conventions: "Not yet analyzed.",
    });

    return { agentId: repoName };
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.store.deleteAgent(agentId);
    this.blockStorage.delete(agentId);
  }

  /** Ground truth for "does this agent actually exist" — the store's agent registry, not local state. */
  async agentExists(agentId: string): Promise<boolean> {
    const ids = await this.store.listAgents();
    return ids.includes(agentId);
  }

  async storePassage(agentId: string, text: string): Promise<string> {
    const uuid = randomUUID();
    await this.store.writePassage(agentId, uuid, text);
    return uuid;
  }

  /**
   * Batch write path: generates one UUID per text and writes them all
   * through the store's batch method when available (fewer embedding round
   * trips), falling back to sequential `writePassage` calls otherwise.
   */
  async storePassages(agentId: string, texts: string[]): Promise<string[]> {
    const entries = texts.map((text) => ({ passageId: randomUUID(), text }));
    if (this.store.writePassages) {
      await this.store.writePassages(agentId, entries);
    } else {
      for (const entry of entries) {
        await this.store.writePassage(agentId, entry.passageId, entry.text);
      }
    }
    return entries.map((entry) => entry.passageId);
  }

  async deletePassage(agentId: string, passageId: string): Promise<void> {
    await this.store.deletePassage(agentId, passageId);
  }

  async listPassages(agentId: string): Promise<Passage[]> {
    return this.store.listPassages(agentId);
  }

  getBlock(agentId: string, label: string): Promise<MemoryBlock> {
    const value = this.blockStorage.get(agentId, label);
    return Promise.resolve({ value, limit: 5000 });
  }

  updateBlock(agentId: string, label: string, value: string): Promise<MemoryBlock> {
    this.blockStorage.set(agentId, label, value);
    return Promise.resolve({ value, limit: 5000 });
  }

  async sendMessage(agentId: string, content: string, options?: SendMessageOptions): Promise<string> {
    const [personaBlock, archBlock, convBlock] = await Promise.all([
      this.getBlock(agentId, "persona"),
      this.getBlock(agentId, "architecture"),
      this.getBlock(agentId, "conventions"),
    ]);

    const systemPromptParts = [
      personaBlock.value,
      `\n## Architecture\n${archBlock.value}`,
      `\n## Conventions\n${convBlock.value}`,
    ];
    if (this.agenticTools) {
      systemPromptParts.push(`\n${agenticSearchGuidance()}`);
    }

    const { tools, toolHandlers } = buildAskTools({
      agentId,
      agenticTools: this.agenticTools,
      repoAccess: this.repoAccess,
      symbolLookup: this.symbolLookup,
      store: this.store,
      updateBlock: (id, label, value) => this.updateBlock(id, label, value),
    });

    return this.runToolCallingLoop({
      systemPrompt: systemPromptParts.join("\n"),
      userMessage: content,
      tools,
      toolHandlers,
      ...(options?.overrideModel === undefined ? {} : { overrideModel: options.overrideModel }),
      ...(options?.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
  }

  /**
   * Consolidation turn: exposes ONLY `memory_replace`, restricted to the
   * architecture/conventions blocks (persona rejected in the handler, not just
   * the prompt), and caps rewrites at the block char limit. Oversized or
   * disallowed writes are rejected so the old block is kept intact.
   */
  async consolidateMemory(agentId: string, prompt: string, options?: ConsolidateMemoryOptions): Promise<void> {
    const blockCharLimit = options?.blockCharLimit ?? 5000;
    const systemPrompt = [
      "You maintain the architecture and conventions memory blocks for a codebase expert.",
      "Refine only those two blocks. Never modify the persona block.",
    ].join("\n");

    const tools: ToolDefinition[] = [CONSOLIDATION_MEMORY_REPLACE_TOOL];
    const toolHandlers = {
      memory_replace: async (args: Record<string, unknown>): Promise<string> => {
        const label = args["label"];
        const value = args["value"];
        if (label !== "architecture" && label !== "conventions") {
          return `Error: block '${String(label)}' cannot be modified during consolidation. Only 'architecture' and 'conventions' are allowed.`;
        }
        if (typeof value !== "string") {
          return `Error: value for '${label}' must be a string.`;
        }
        if (value.length > blockCharLimit) {
          return `Error: value for '${label}' is ${String(value.length)} chars, over the ${String(blockCharLimit)}-char limit. Keep it shorter; the old block was left unchanged.`;
        }
        await this.updateBlock(agentId, label, value);
        return `Updated block '${label}'`;
      },
    };

    await this.runToolCallingLoop({
      systemPrompt,
      userMessage: prompt,
      tools,
      toolHandlers,
      maxSteps: options?.maxSteps ?? 2,
      ...(options?.overrideModel === undefined ? {} : { overrideModel: options.overrideModel }),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async runToolCallingLoop(params: {
    systemPrompt: string;
    userMessage: string;
    tools: ToolDefinition[];
    toolHandlers: Partial<Record<string, ToolHandler>>;
    overrideModel?: string;
    maxSteps?: number;
    signal?: AbortSignal;
  }): Promise<string> {
    const { systemPrompt, userMessage, tools, toolHandlers, overrideModel, maxSteps, signal } = params;

    const modelCandidates = overrideModel
      ? [overrideModel]
      : [this.model, ...this.fallbackModels.filter((candidate) => candidate !== this.model)];
    const failureMessages: string[] = [];

    for (const modelCandidate of modelCandidates) {
      for (let attempt = 0; attempt <= this.maxRetriesPerModel; attempt++) {
        if (signal?.aborted) {
          const reason: unknown = signal.reason;
          throw reason instanceof Error ? reason : new Error(unknownToMessage(reason) || "Request aborted");
        }

        try {
          const loopParams = {
            systemPrompt,
            userMessage,
            tools,
            toolHandlers,
            model: modelCandidate,
            baseUrl: this.baseUrl,
            requestTimeoutMs: this.requestTimeoutMs,
            ...(this.apiKey === undefined ? {} : { apiKey: this.apiKey }),
            ...(maxSteps === undefined ? {} : { maxSteps }),
            ...(signal === undefined ? {} : { signal }),
          };
          return await toolCallingLoop(loopParams);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failureMessages.push(`${modelCandidate} (attempt ${String(attempt + 1)}): ${message}`);
          if (signal?.aborted || isAbortLikeError(error)) throw error;
          if (!isRetryableModelError(error)) throw error;
          if (attempt >= this.maxRetriesPerModel) break;
          const backoffMs = this.retryBaseDelayMs * Math.pow(2, attempt);
          await sleep(backoffMs);
        }
      }
    }

    throw new Error(`All model attempts failed:\n${failureMessages.join("\n")}`);
  }
}
