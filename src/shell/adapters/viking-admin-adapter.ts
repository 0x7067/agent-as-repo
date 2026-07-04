import type { AdminPort, AgentSummary, CoreMemoryBlock, PassageResult } from "../../ports/admin.js";
import type { AgentProvider } from "../../ports/agent-provider.js";
import type { PassageStore } from "../../ports/passage-store.js";

export class VikingAdminAdapter implements AdminPort {
  constructor(
    private readonly provider: AgentProvider,
    private readonly store: PassageStore,
  ) {}

  async listAgents(): Promise<AgentSummary[]> {
    const ids = await this.store.listAgents();
    return ids.map((id) => ({ id, name: id }));
  }

  async getAgent(agentId: string): Promise<Record<string, unknown>> {
    const blocks = await this.getCoreMemory(agentId);
    return { id: agentId, name: agentId, blocks };
  }

  async getCoreMemory(agentId: string): Promise<CoreMemoryBlock[]> {
    const labels = ["persona", "architecture", "conventions"];
    const results: CoreMemoryBlock[] = [];
    for (const label of labels) {
      try {
        const block = await this.provider.getBlock(agentId, label);
        results.push({ label, value: block.value, limit: block.limit });
      } catch {
        // skip missing blocks
      }
    }
    return results;
  }

  async searchPassages(agentId: string, query: string, limit?: number): Promise<PassageResult[]> {
    const results = await this.store.semanticSearch(agentId, query, limit ?? 10);
    return results.map((r) => ({ id: r.id, text: r.text }));
  }
}
