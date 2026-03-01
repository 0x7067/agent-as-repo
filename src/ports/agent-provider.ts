export interface CreateAgentParams {
  name: string;
  repoName: string;
  description: string;
  persona?: string;
  tags: string[];
  model: string;
  embedding: string;
  memoryBlockLimit: number;
  tools?: string[];
}

export interface CreateAgentResult {
  agentId: string;
}

export interface Passage {
  id: string;
  text: string;
}

export interface MemoryBlock {
  value: string;
  limit: number;
}

export interface SendMessageOptions {
  overrideModel?: string;
  maxSteps?: number;
}

export interface AgentProvider {
  createAgent(params: CreateAgentParams): Promise<CreateAgentResult>;
  deleteAgent(agentId: string): Promise<void>;
  enableSleeptime(agentId: string): Promise<void>;
  storePassage(agentId: string, text: string): Promise<string>;
  deletePassage(agentId: string, passageId: string): Promise<void>;
  listPassages(agentId: string): Promise<Passage[]>;
  getBlock(agentId: string, label: string): Promise<MemoryBlock>;
  updateBlock(agentId: string, label: string, value: string): Promise<MemoryBlock>;
  sendMessage(agentId: string, content: string, options?: SendMessageOptions): Promise<string>;
}
