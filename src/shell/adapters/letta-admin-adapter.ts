import type { Letta } from "@letta-ai/letta-client";
import type { AdminPort, AgentSummary, CoreMemoryBlock, PassageResult } from "../../ports/admin.js";

export class LettaAdminAdapter implements AdminPort {
  constructor(private readonly client: Letta) {}

  async listAgents(): Promise<AgentSummary[]> {
    const summary: AgentSummary[] = [];
    for await (const a of this.client.agents.list()) {
      summary.push({ id: a.id, name: a.name, description: a.description, model: a.model ?? null });
    }
    return summary;
  }

  async getAgent(agentId: string): Promise<Record<string, unknown>> {
    const agent = await this.client.agents.retrieve(agentId);
    return agent as unknown as Record<string, unknown>;
  }

  async getCoreMemory(agentId: string): Promise<CoreMemoryBlock[]> {
    const agent = await this.client.agents.retrieve(agentId);
    const blocks = (agent.blocks as Array<{ label: string; value: string; limit: number }> | null) ?? [];
    return blocks.map((b) => ({
      label: b.label,
      value: b.value,
      limit: b.limit,
    }));
  }

  async searchPassages(agentId: string, query: string, limit?: number): Promise<PassageResult[]> {
    const results = await this.client.agents.passages.search(agentId, { query, top_k: limit });
    return (results as Array<{ id: string; text: string }>).map((r) => ({ id: r.id, text: r.text }));
  }
}
