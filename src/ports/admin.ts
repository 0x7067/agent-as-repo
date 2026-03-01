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
  listAgents(): Promise<AgentSummary[]>;
  getAgent(agentId: string): Promise<Record<string, unknown>>;
  getCoreMemory(agentId: string): Promise<CoreMemoryBlock[]>;
  searchPassages(agentId: string, query: string, limit?: number): Promise<PassageResult[]>;
}
