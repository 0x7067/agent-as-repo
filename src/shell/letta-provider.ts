import type Letta from "@letta-ai/letta-client";
import { buildPersona } from "../core/prompts.js";
import type { AgentProvider, CreateAgentParams, CreateAgentResult, Passage, MemoryBlock } from "./provider.js";

export class LettaProvider implements AgentProvider {
  constructor(private client: Letta) {}

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
    await this.client.agents.passages.delete(passageId, { agent_id: agentId });
  }

  async listPassages(agentId: string): Promise<Passage[]> {
    const list = await this.client.agents.passages.list(agentId);
    return (list as any[]).map((p) => ({ id: p.id, text: p.text }));
  }

  async getBlock(agentId: string, label: string): Promise<MemoryBlock> {
    const block = await this.client.agents.blocks.retrieve(label, { agent_id: agentId });
    return { value: (block as any).value, limit: (block as any).limit };
  }

  async storePassage(agentId: string, text: string): Promise<string> {
    const result = await this.client.agents.passages.create(agentId, { text });
    return (result as any)[0].id;
  }

  async sendMessage(agentId: string, content: string): Promise<string> {
    const resp = await this.client.agents.messages.create(agentId, {
      messages: [{ role: "user", content }],
    });

    for (const msg of resp.messages) {
      if ((msg as any).message_type === "assistant_message") {
        return (msg as any).content ?? "";
      }
    }

    return "";
  }
}
