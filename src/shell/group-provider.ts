/**
 * GroupProvider interface — placeholder for Letta Groups API.
 *
 * Implementation blocked until @letta-ai/letta-client exposes the Groups API.
 * See idea.md Phase 4 for planned usage (DynamicManager, SleeptimeManager).
 */

export interface DynamicManagerConfig {
  managerAgentId: string;
  terminationToken: string;
  maxTurns: number;
}

export interface SleeptimeManagerConfig {
  managerAgentId: string;
  sleeptimeAgentFrequency: number;
}

export type ManagerConfig =
  | { type: "dynamic"; config: DynamicManagerConfig }
  | { type: "sleeptime"; config: SleeptimeManagerConfig }
  | { type: "round_robin" }
  | { type: "supervisor"; config: { managerAgentId: string } };

export interface CreateGroupParams {
  agentIds: string[];
  description: string;
  managerConfig: ManagerConfig;
}

export interface CreateGroupResult {
  groupId: string;
}

export interface GroupProvider {
  createGroup(params: CreateGroupParams): Promise<CreateGroupResult>;
  deleteGroup(groupId: string): Promise<void>;
  sendToGroup(groupId: string, content: string): Promise<string>;
}
