/** Synchronous storage for agent memory blocks (persona, architecture, conventions). */
export interface BlockStorage {
  get(agentId: string, label: string): string;
  set(agentId: string, label: string, value: string): void;
  init(agentId: string, blocks: Record<string, string>): void;
  delete(agentId: string): void;
}
