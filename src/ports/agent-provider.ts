export interface CreateAgentParams {
  name: string;
  repoName: string;
  description: string;
  persona?: string;
  model: string;
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

export interface ConsolidateMemoryOptions {
  overrideModel?: string;
  maxSteps?: number;
  signal?: AbortSignal;
  /** Max characters allowed per block; oversized rewrites are rejected. */
  blockCharLimit?: number;
}

export interface AgentProvider {
  createAgent(this: void, params: CreateAgentParams): Promise<CreateAgentResult>;
  deleteAgent(this: void, agentId: string): Promise<void>;
  storePassage(this: void, agentId: string, text: string): Promise<string>;
  /**
   * Batch write path: stores multiple passages together (fewer embedding
   * round trips than one `storePassage` per text) and returns passage IDs in
   * input order. Optional — callers must fall back to per-text
   * `storePassage` when an implementation doesn't provide this.
   */
  storePassages?(this: void, agentId: string, texts: string[]): Promise<string[]>;
  deletePassage(this: void, agentId: string, passageId: string): Promise<void>;
  listPassages(this: void, agentId: string): Promise<Passage[]>;
  getBlock(this: void, agentId: string, label: string): Promise<MemoryBlock>;
  updateBlock(this: void, agentId: string, label: string, value: string): Promise<MemoryBlock>;
  sendMessage(this: void, agentId: string, content: string, options?: SendMessageOptions): Promise<string>;
  /**
   * Run a single restricted tool-calling turn that may rewrite ONLY the
   * architecture/conventions blocks via `memory_replace`. The persona block is
   * never exposed. Implementations must reject oversized or non-allowed writes
   * so consolidation can never make memory worse.
   */
  consolidateMemory(this: void, agentId: string, prompt: string, options?: ConsolidateMemoryOptions): Promise<void>;
}
