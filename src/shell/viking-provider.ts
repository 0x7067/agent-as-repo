import { randomUUID } from "node:crypto";
import { buildPersona } from "../core/prompts.js";
import type {
  AgentProvider,
  CreateAgentParams,
  CreateAgentResult,
  Passage,
  MemoryBlock,
  SendMessageOptions,
} from "../ports/agent-provider.js";
import type { VikingHttpClient } from "./viking-http.js";
import { toolCallingLoop, type ToolDefinition } from "./openrouter-client.js";
import type { BlockStorage } from "./block-storage.js";

export interface VikingRuntimeOptions {
  fallbackModels?: string[];
  requestTimeoutMs?: number;
  maxRetriesPerModel?: number;
  retryBaseDelayMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES_PER_MODEL = 1;
const DEFAULT_RETRY_BASE_DELAY_MS = 600;
const DEFAULT_FALLBACK_MODELS = [
  "moonshotai/kimi-k2.5",
  "deepseek/deepseek-v3.2",
  "z-ai/glm-5",
];

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

function isDeletePassageAmbiguousFsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("http 500") && message.includes("/api/v1/fs");
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

export class VikingProvider implements AgentProvider {
  private readonly fallbackModels: string[];
  private readonly requestTimeoutMs: number;
  private readonly maxRetriesPerModel: number;
  private readonly retryBaseDelayMs: number;

  constructor(
    private viking: VikingHttpClient,
    private openrouterApiKey: string,
    private model: string,
    private blockStorage: BlockStorage,
    runtimeOptions: VikingRuntimeOptions = {},
  ) {
    this.fallbackModels = runtimeOptions.fallbackModels && runtimeOptions.fallbackModels.length > 0
      ? runtimeOptions.fallbackModels
      : DEFAULT_FALLBACK_MODELS;
    this.requestTimeoutMs = runtimeOptions.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxRetriesPerModel = runtimeOptions.maxRetriesPerModel ?? DEFAULT_MAX_RETRIES_PER_MODEL;
    this.retryBaseDelayMs = runtimeOptions.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  }

  async createAgent(params: CreateAgentParams): Promise<CreateAgentResult> {
    const { repoName } = params;
    const persona = buildPersona(repoName, params.description, params.persona, params.tools);

    await this.viking.mkdir(`viking://resources/${repoName}/`);
    await this.viking.mkdir(`viking://resources/${repoName}/passages/`);

    await this.viking.writeFile(
      `viking://resources/${repoName}/manifest.json`,
      JSON.stringify({
        agentId: repoName,
        name: params.name,
        model: params.model,
        tags: params.tags,
        createdAt: new Date().toISOString(),
      }),
    );

    this.blockStorage.init(repoName, {
      persona,
      architecture: "Not yet analyzed.",
      conventions: "Not yet analyzed.",
    });

    return { agentId: repoName };
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.viking.deleteResource(`viking://resources/${agentId}/`);
    this.blockStorage.delete(agentId);
  }

  enableSleeptime(_agentId: string): Promise<void> {
    return Promise.resolve();
  }

  async storePassage(agentId: string, text: string): Promise<string> {
    const uuid = randomUUID();
    await this.viking.writeFile(`viking://resources/${agentId}/passages/${uuid}.txt`, text);
    return uuid;
  }

  async deletePassage(agentId: string, passageId: string): Promise<void> {
    const targetUri = `viking://resources/${agentId}/passages/${passageId}.txt`;
    try {
      await this.viking.deleteFile(targetUri);
      return;
    } catch (error) {
      if (!isDeletePassageAmbiguousFsError(error)) throw error;

      const listUri = `viking://resources/${agentId}/passages/`;
      const siblingUris = await this.viking.listDirectory(listUri);
      const hasTarget = siblingUris.some((uri) => uri.endsWith(`/${passageId}.txt`));
      if (!hasTarget) return;

      await sleep(120);
      try {
        await this.viking.deleteFile(targetUri);
        return;
      } catch (retryError) {
        if (!isDeletePassageAmbiguousFsError(retryError)) throw retryError;
        const afterRetryUris = await this.viking.listDirectory(listUri);
        const stillExists = afterRetryUris.some((uri) => uri.endsWith(`/${passageId}.txt`));
        if (!stillExists) return;
        throw retryError;
      }
    }
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  async listPassages(agentId: string): Promise<Passage[]> {
    const uris = await this.viking.listDirectory(`viking://resources/${agentId}/passages/`);
    const readPassage = async (uri: string): Promise<Passage> => {
      const text = await this.viking.readFile(uri);
      const filename = uri.slice(uri.lastIndexOf("/") + 1);
      const id = filename.endsWith(".txt") ? filename.slice(0, -4) : filename;
      return { id, text };
    };

    const settled = await Promise.allSettled(uris.map((uri) => readPassage(uri)));

    const passages: Passage[] = [];
    const failedUris: string[] = [];
    let firstError: unknown;

    for (const [index, entry] of settled.entries()) {
      if (entry.status === "fulfilled") {
        passages.push(entry.value);
        continue;
      }
      const uri = uris[index];
      if (uri) {
        failedUris.push(uri);
      }
      if (firstError === undefined) {
        firstError = entry.reason;
      }
    }

    if (failedUris.length > 0) {
      await sleep(120);
      const retrySettled = await Promise.allSettled(failedUris.map((uri) => readPassage(uri)));
      for (const retryEntry of retrySettled) {
        if (retryEntry.status === "fulfilled") {
          passages.push(retryEntry.value);
          continue;
        }
        if (firstError === undefined) {
          firstError = retryEntry.reason;
        }
      }
    }

    if (passages.length === 0 && firstError !== undefined) {
      throw firstError instanceof Error
        ? firstError
        : new Error(unknownToMessage(firstError) || "Failed to list passages");
    }

    return passages;
  }

  getBlock(agentId: string, label: string): Promise<MemoryBlock> {
    const value = this.blockStorage.get(agentId, label);
    return Promise.resolve({ value, limit: 5000 });
  }

  updateBlock(agentId: string, label: string, value: string): Promise<MemoryBlock> {
    this.blockStorage.set(agentId, label, value);
    return Promise.resolve({ value, limit: 5000 });
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  async sendMessage(agentId: string, content: string, options?: SendMessageOptions): Promise<string> {
    const [personaBlock, archBlock, convBlock] = await Promise.all([
      this.getBlock(agentId, "persona"),
      this.getBlock(agentId, "architecture"),
      this.getBlock(agentId, "conventions"),
    ]);

    const systemPrompt = [
      personaBlock.value,
      `\n## Architecture\n${archBlock.value}`,
      `\n## Conventions\n${convBlock.value}`,
    ].join("\n");

    const tools: ToolDefinition[] = [
      {
        type: "function",
        function: {
          name: "archival_memory_search",
          description: "Search for relevant code and documentation in archival memory",
          parameters: {
            type: "object",
            properties: { query: { type: "string", description: "Search query" } },
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
    ];

    const toolHandlers = {
      archival_memory_search: async (args: Record<string, unknown>): Promise<string> => {
        const query = args.query as string;
        const results = await this.viking.semanticSearch(query, `viking://resources/${agentId}/passages/`, 10);
        return JSON.stringify(results);
      },
      memory_replace: async (args: Record<string, unknown>): Promise<string> => {
        const label = args.label as string;
        const value = args.value as string;
        await this.updateBlock(agentId, label, value);
        return `Updated block '${label}'`;
      },
    };

    const modelCandidates = options?.overrideModel
      ? [options.overrideModel]
      : [this.model, ...this.fallbackModels.filter((candidate) => candidate !== this.model)];
    const failureMessages: string[] = [];

    for (const modelCandidate of modelCandidates) {
      for (let attempt = 0; attempt <= this.maxRetriesPerModel; attempt++) {
        if (options?.signal?.aborted) {
          const reason: unknown = options.signal.reason;
          throw reason instanceof Error ? reason : new Error(unknownToMessage(reason) || "Request aborted");
        }

        try {
          const loopParams = {
            systemPrompt,
            userMessage: content,
            tools,
            toolHandlers,
            model: modelCandidate,
            apiKey: this.openrouterApiKey,
            requestTimeoutMs: this.requestTimeoutMs,
            ...(options?.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
            ...(options?.signal === undefined ? {} : { signal: options.signal }),
          };
          return await toolCallingLoop(loopParams);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failureMessages.push(`${modelCandidate} (attempt ${String(attempt + 1)}): ${message}`);
          if (options?.signal?.aborted || isAbortLikeError(error)) throw error;
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
