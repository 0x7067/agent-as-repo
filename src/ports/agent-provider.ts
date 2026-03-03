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
  signal?: AbortSignal;
}

export interface AgentProvider {
  createAgent(this: void, params: CreateAgentParams): Promise<CreateAgentResult>;
  deleteAgent(this: void, agentId: string): Promise<void>;
  enableSleeptime(this: void, agentId: string): Promise<void>;
  storePassage(this: void, agentId: string, text: string): Promise<string>;
  deletePassage(this: void, agentId: string, passageId: string): Promise<void>;
  listPassages(this: void, agentId: string): Promise<Passage[]>;
  getBlock(this: void, agentId: string, label: string): Promise<MemoryBlock>;
  updateBlock(this: void, agentId: string, label: string, value: string): Promise<MemoryBlock>;
  sendMessage(this: void, agentId: string, content: string, options?: SendMessageOptions): Promise<string>;
}
