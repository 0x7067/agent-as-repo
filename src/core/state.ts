import type { AgentState, AppState, PassageMap } from "./types.js";

export const STATE_SCHEMA_VERSION = 2;

export function createEmptyState(): AppState {
  return { stateVersion: STATE_SCHEMA_VERSION, agents: {} };
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
  const existing = getAgentOrThrow(state, repoName);

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
  const existing = getAgentOrThrow(state, repoName);

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
  const agents = Object.fromEntries(
    Object.entries(state.agents).filter(([name]) => name !== repoName),
  ) as Record<string, AgentState>;
  return { ...state, agents };
}

function getAgentOrThrow(state: AppState, repoName: string): AgentState {
  const existing = Object.hasOwn(state.agents, repoName)
    ? state.agents[repoName]
    : undefined;
  if (existing === undefined) {
    throw new Error(`No agent found for repo: ${repoName}`);
  }
  return existing;
}
