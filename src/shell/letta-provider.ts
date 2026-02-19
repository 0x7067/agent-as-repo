import type { Letta } from "@letta-ai/letta-client";
import type { Passage as LettaPassage } from "@letta-ai/letta-client/resources/passages.js";
import type { BlockResponse } from "@letta-ai/letta-client/resources/blocks/blocks.js";
import type { AssistantMessage, LettaResponse } from "@letta-ai/letta-client/resources/agents/messages.js";
import { buildPersona } from "../core/prompts.js";
import type {
  AgentProvider,
  CreateAgentParams,
  CreateAgentResult,
  Passage,
  MemoryBlock,
  SendMessageOptions,
} from "./provider.js";

function isHttpStatus(err: unknown, code: number): boolean {
  if (typeof err !== "object" || err === null) return false;
  const obj = err as Record<string, unknown>;
  return obj.status === code || obj.statusCode === code;
}

const TRANSIENT_HTTP_CODES = [429, 500, 502, 503];
const TRANSIENT_NETWORK_CODES = ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE", "EAI_AGAIN"];

export function isTransientError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const obj = err as Record<string, unknown>;
  const status = obj.status ?? obj.statusCode;
  if (typeof status === "number" && TRANSIENT_HTTP_CODES.includes(status)) return true;
  if (typeof obj.code === "string" && TRANSIENT_NETWORK_CODES.includes(obj.code)) return true;
  return false;
}

function getRetryAfterMs(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const obj = err as Record<string, unknown>;
  const headers = obj.headers as Record<string, unknown> | undefined;
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (typeof raw === "string") {
    const seconds = Number(raw);
    if (!Number.isNaN(seconds) && seconds > 0 && seconds < 300) return seconds * 1000;
  }
  if (typeof raw === "number" && raw > 0 && raw < 300) return raw * 1000;
  return null;
}

export class LettaProvider implements AgentProvider {
  constructor(private client: Letta, private retryBaseDelay = 1000) {}

  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (!isTransientError(err) || attempt === maxRetries) throw err;
        const retryAfter = getRetryAfterMs(err);
        const baseDelay = retryAfter ?? this.retryBaseDelay * Math.pow(2, attempt);
        const jitter = 0.5 + Math.random() * 0.5;
        await new Promise((resolve) => setTimeout(resolve, baseDelay * jitter));
      }
    }
    throw new Error("retry loop exhausted without result");
  }

  async createAgent(params: CreateAgentParams): Promise<CreateAgentResult> {
    const persona = buildPersona(params.repoName, params.description, params.persona, params.tools);

    const agent = await this.client.agents.create({
      name: params.name,
      model: params.model,
      embedding: params.embedding,
      tools: ["archival_memory_search", ...(params.tools ?? [])],
      tags: params.tags,
      memory_blocks: [
        { label: "persona", value: persona, limit: params.memoryBlockLimit },
        { label: "architecture", value: "Not yet analyzed.", limit: params.memoryBlockLimit },
        { label: "conventions", value: "Not yet analyzed.", limit: params.memoryBlockLimit },
      ],
    });

    return { agentId: agent.id };
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.client.agents.delete(agentId);
  }

  async deletePassage(agentId: string, passageId: string): Promise<void> {
    try {
      await this.withRetry(() => this.client.agents.passages.delete(passageId, { agent_id: agentId }));
    } catch (err) {
      if (isHttpStatus(err, 404)) return; // Already deleted — treat as success
      throw err;
    }
  }

  async listPassages(agentId: string): Promise<Passage[]> {
    const list: LettaPassage[] = await this.withRetry(() => this.client.agents.passages.list(agentId));
    return list.filter((p) => p.id).map((p) => ({ id: p.id as string, text: p.text }));
  }

  async getBlock(agentId: string, label: string): Promise<MemoryBlock> {
    const block: BlockResponse = await this.withRetry(() =>
      this.client.agents.blocks.retrieve(label, { agent_id: agentId }),
    );
    return { value: block.value, limit: block.limit ?? 0 };
  }

  async storePassage(agentId: string, text: string): Promise<string> {
    const result: LettaPassage[] = await this.withRetry(() =>
      this.client.agents.passages.create(agentId, { text }),
    );
    const id = result[0]?.id;
    if (!id) {
      throw new Error(`storePassage returned no valid passage ID for agent ${agentId}`);
    }
    return id;
  }

  async sendMessage(agentId: string, content: string, options?: SendMessageOptions): Promise<string> {
    const payload: {
      messages: Array<{ role: "user"; content: string }>;
      override_model?: string;
      max_steps?: number;
    } = {
      messages: [{ role: "user", content }],
    };
    if (options?.overrideModel) {
      payload.override_model = options.overrideModel;
    }
    if (options?.maxSteps !== undefined) {
      payload.max_steps = options.maxSteps;
    }

    const resp: LettaResponse = await this.withRetry(() =>
      this.client.agents.messages.create(agentId, payload),
    );

    for (const msg of resp.messages) {
      if (msg.message_type === "assistant_message") {
        const assistantMsg = msg as AssistantMessage;
        const text = assistantMsg.content;
        return typeof text === "string" ? text : "";
      }
    }

    return "";
  }
}
