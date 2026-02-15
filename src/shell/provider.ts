export interface CreateAgentParams {
  name: string;
  repoName: string;
  description: string;
  persona?: string;
  tags: string[];
  model: string;
  embedding: string;
  memoryBlockLimit: number;
}

export interface CreateAgentResult {
  agentId: string;
}

export interface AgentProvider {
  createAgent(params: CreateAgentParams): Promise<CreateAgentResult>;
  deleteAgent(agentId: string): Promise<void>;
  storePassage(agentId: string, text: string): Promise<string>;
  sendMessage(agentId: string, content: string): Promise<string>;
}
