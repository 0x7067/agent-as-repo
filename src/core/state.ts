import type { AgentState, AppState, PassageMap } from "./types.js";

export function createEmptyState(): AppState {
  return { agents: {} };
}

export function addAgentToState(
  state: AppState,
  repoName: string,
  agentId: string,
  createdAt: string,
): AppState {
  return {
    ...state,
    agents: {
      ...state.agents,
      [repoName]: {
        agentId,
        repoName,
        passages: {},
        lastBootstrap: null,
        lastSyncCommit: null,
        lastSyncAt: null,
        createdAt,
      },
    },
  };
}

export function updatePassageMap(
  state: AppState,
  repoName: string,
  passages: PassageMap,
): AppState {
  const existing = state.agents[repoName];
  if (!existing) throw new Error(`No agent found for repo: ${repoName}`);

  return {
    ...state,
    agents: {
      ...state.agents,
      [repoName]: { ...existing, passages },
    },
  };
}

export function updateAgentField(
  state: AppState,
  repoName: string,
  updates: Partial<Omit<AgentState, "agentId" | "repoName" | "createdAt">>,
): AppState {
  const existing = state.agents[repoName];
  if (!existing) throw new Error(`No agent found for repo: ${repoName}`);

  return {
    ...state,
    agents: {
      ...state.agents,
      [repoName]: { ...existing, ...updates },
    },
  };
}

export function removeAgentFromState(
  state: AppState,
  repoName: string,
): AppState {
  const { [repoName]: _, ...rest } = state.agents;
  return { ...state, agents: rest };
}
