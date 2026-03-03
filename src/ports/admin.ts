export interface AgentSummary {
  id: string;
  name: string;
  description?: string | null;
  model?: string | null;
}

export interface PassageResult {
  id: string;
  text: string;
}

export interface CoreMemoryBlock {
  label: string;
  value: string;
  limit: number;
}

export interface AdminPort {
  listAgents(this: void): Promise<AgentSummary[]>;
  getAgent(this: void, agentId: string): Promise<Record<string, unknown>>;
  getCoreMemory(this: void, agentId: string): Promise<CoreMemoryBlock[]>;
  searchPassages(this: void, agentId: string, query: string, limit?: number): Promise<PassageResult[]>;
}
