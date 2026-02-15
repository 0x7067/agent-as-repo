import { describe, it, expect } from "vitest";
import {
  createEmptyState,
  addAgentToState,
  updatePassageMap,
  removeAgentFromState,
} from "./state.js";

describe("state operations", () => {
  it("creates an empty state", () => {
    const state = createEmptyState();
    expect(state.agents).toEqual({});
  });

  it("adds an agent to state", () => {
    const state = createEmptyState();
    const next = addAgentToState(state, "my-app", "agent-123");
    expect(next.agents["my-app"]).toBeDefined();
    expect(next.agents["my-app"].agentId).toBe("agent-123");
    expect(next.agents["my-app"].repoName).toBe("my-app");
    expect(next.agents["my-app"].passages).toEqual({});
    expect(next.agents["my-app"].lastBootstrap).toBeNull();
  });

  it("does not mutate original state", () => {
    const state = createEmptyState();
    addAgentToState(state, "my-app", "agent-123");
    expect(state.agents).toEqual({});
  });

  it("updates passage map for an agent", () => {
    let state = createEmptyState();
    state = addAgentToState(state, "my-app", "agent-123");
    const passages = { "src/index.ts": ["p1", "p2"], "src/utils.ts": ["p3"] };
    const next = updatePassageMap(state, "my-app", passages);
    expect(next.agents["my-app"].passages).toEqual(passages);
  });

  it("throws when updating passages for unknown agent", () => {
    const state = createEmptyState();
    expect(() => updatePassageMap(state, "nope", {})).toThrow();
  });

  it("removes an agent from state", () => {
    let state = createEmptyState();
    state = addAgentToState(state, "my-app", "agent-123");
    const next = removeAgentFromState(state, "my-app");
    expect(next.agents["my-app"]).toBeUndefined();
  });
});
