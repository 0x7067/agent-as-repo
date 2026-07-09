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
import { handleGlobFiles, handleGrepRepo, handleReadFile } from "./repo-tools.js";

export interface LocalRuntimeOptions {
  baseUrl?: string;
  apiKey?: string;
  fallbackModels?: string[];
  requestTimeoutMs?: number;
  maxRetriesPerModel?: number;
  retryBaseDelayMs?: number;
  /**
   * When true (standalone CLI ask), expose grep_repo / glob_files / read_file.
   * MCP / coding-harness surfaces leave this false — the host already has those tools.
   */
  agenticTools?: boolean;
  /** Live-repo access required when agenticTools is enabled. */
  repoAccess?: RepoAccessPort;
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
    const systemPrompt = systemPromptParts.join("\n");

    const tools: ToolDefinition[] = [];
    const toolHandlers: Partial<Record<string, ToolHandler>> = {};

    if (this.agenticTools) {
      tools.push(
        {
          type: "function",
          function: {
            name: "grep_repo",
            description:
              "Regex search the live repository with ripgrep. Prefer this for exact identifiers, strings, and patterns.",
            parameters: {
              type: "object",
              properties: {
                pattern: { type: "string", description: "Regex or fixed pattern to search for" },
                path: { type: "string", description: "Optional relative directory or file to scope the search" },
                glob: { type: "string", description: "Optional glob filter (e.g. *.ts)" },
                case_insensitive: { type: "boolean", description: "Case-insensitive search" },
                max_results: { type: "number", description: "Max matches per file (default 50)" },
              },
              required: ["pattern"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "glob_files",
            description: "List files in the live repository matching a glob pattern",
            parameters: {
              type: "object",
              properties: {
                pattern: { type: "string", description: "Glob pattern (default **/*)" },
              },
              required: [],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read a file from the live repository by relative path",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Relative path from the repo root" },
              },
              required: ["path"],
            },
          },
        },
      );

      const missingRepoAccess = (): string =>
        JSON.stringify({
          error:
            "Live repo access is not configured for this agent. Archival search still works; configure config.yaml repos to enable grep/glob/read.",
        });

      toolHandlers["grep_repo"] = async (args: Record<string, unknown>): Promise<string> => {
        if (this.repoAccess === undefined) return missingRepoAccess();
        return handleGrepRepo(this.repoAccess, agentId, args);
      };
      toolHandlers["glob_files"] = async (args: Record<string, unknown>): Promise<string> => {
        if (this.repoAccess === undefined) return missingRepoAccess();
        return handleGlobFiles(this.repoAccess, agentId, args);
      };
      toolHandlers["read_file"] = async (args: Record<string, unknown>): Promise<string> => {
        if (this.repoAccess === undefined) return missingRepoAccess();
        return handleReadFile(this.repoAccess, agentId, args);
      };
    }

    tools.push(
      {
        type: "function",
        function: {
          name: "archival_memory_search",
          description:
            "Semantic + BM25 recall over indexed passages. Use for conceptual questions; optionally narrow with path_prefix.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
              path_prefix: {
                type: "string",
                description: "Optional file_path prefix to stage-narrow results (e.g. src/auth)",
              },
            },
            required: ["query"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "memory_replace",
          description: "Update a memory block with new content",
          parameters: {
            type: "object",
            properties: {
              label: { type: "string", description: "Block label (persona, architecture, conventions)" },
              value: { type: "string", description: "New block content" },
            },
            required: ["label", "value"],
          },
        },
      },
    );

    toolHandlers["archival_memory_search"] = async (args: Record<string, unknown>): Promise<string> => {
      const query = args["query"] as string;
      const pathPrefix = typeof args["path_prefix"] === "string" ? args["path_prefix"] : undefined;
      const results = await this.store.semanticSearch(
        agentId,
        query,
        10,
        pathPrefix === undefined || pathPrefix === "" ? undefined : { pathPrefix },
      );
      return JSON.stringify(results);
    };
    toolHandlers["memory_replace"] = async (args: Record<string, unknown>): Promise<string> => {
      const label = args["label"] as string;
      const value = args["value"] as string;
      await this.updateBlock(agentId, label, value);
      return `Updated block '${label}'`;
    };

    return this.runToolCallingLoop({
      systemPrompt,
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

    const tools: ToolDefinition[] = [
      {
        type: "function",
        function: {
          name: "memory_replace",
          description: "Update the architecture or conventions memory block with new content",
          parameters: {
            type: "object",
            properties: {
              label: { type: "string", description: "Block label (architecture or conventions)" },
              value: { type: "string", description: "New block content" },
            },
            required: ["label", "value"],
          },
        },
      },
    ];

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
