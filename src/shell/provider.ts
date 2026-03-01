// AgentProvider was promoted to the ports layer.
// Re-exported here for backwards compatibility with existing imports.
export type {
  AgentProvider,
  CreateAgentParams,
  CreateAgentResult,
  MemoryBlock,
  Passage,
  SendMessageOptions,
} from "../ports/agent-provider.js";
