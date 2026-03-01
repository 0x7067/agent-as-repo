import type { AdminPort, AgentSummary, CoreMemoryBlock, PassageResult } from "../../ports/admin.js";
import type { VikingProvider } from "../viking-provider.js";
import type { VikingHttpClient } from "../viking-http.js";

export class VikingAdminAdapter implements AdminPort {
  constructor(
    private readonly provider: VikingProvider,
    private readonly viking: VikingHttpClient,
  ) {}

  async listAgents(): Promise<AgentSummary[]> {
    const uris = await this.viking.listDirectory("viking://resources/");
    return uris.map((uri) => {
      const name = uri.replace(/^viking:\/\/resources\//, "").replace(/\/$/, "");
      return { id: name, name };
    });
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
    const passages = await this.provider.listPassages(agentId);
    const lq = query.toLowerCase();
    const filtered = passages.filter((p) => p.text.toLowerCase().includes(lq));
    const capped = limit !== undefined ? filtered.slice(0, limit) : filtered;
    return capped.map((p) => ({ id: p.id, text: p.text }));
  }
}
