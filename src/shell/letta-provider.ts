import type Letta from "@letta-ai/letta-client";
import type { Passage as LettaPassage } from "@letta-ai/letta-client/resources/passages.js";
import type { BlockResponse } from "@letta-ai/letta-client/resources/blocks/blocks.js";
import type { AssistantMessage, LettaResponse } from "@letta-ai/letta-client/resources/agents/messages.js";
import { buildPersona } from "../core/prompts.js";
import type { AgentProvider, CreateAgentParams, CreateAgentResult, Passage, MemoryBlock } from "./provider.js";

function isRateLimitError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    (err as { statusCode: unknown }).statusCode === 429
  );
}

export class LettaProvider implements AgentProvider {
  constructor(private client: Letta, private retryBaseDelay = 1000) {}

  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (!isRateLimitError(err) || attempt === maxRetries) throw err;
        lastError = err;
        const delay = this.retryBaseDelay * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }

  async createAgent(params: CreateAgentParams): Promise<CreateAgentResult> {
    const persona = buildPersona(params.repoName, params.description, params.persona);

    const agent = await this.client.agents.create({
      name: params.name,
      model: params.model,
      embedding: params.embedding,
      tools: ["archival_memory_search"],
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
    await this.withRetry(() => this.client.agents.passages.delete(passageId, { agent_id: agentId }));
  }

  async listPassages(agentId: string): Promise<Passage[]> {
    const list: LettaPassage[] = await this.withRetry(() => this.client.agents.passages.list(agentId));
    return list.map((p) => ({ id: p.id ?? "", text: p.text }));
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
    return result[0].id ?? "";
  }

  async sendMessage(agentId: string, content: string): Promise<string> {
    const resp: LettaResponse = await this.withRetry(() =>
      this.client.agents.messages.create(agentId, {
        messages: [{ role: "user", content }],
      }),
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
