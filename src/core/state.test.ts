import { describe, it, expect } from "vitest";
import {
  STATE_SCHEMA_VERSION,
  createEmptyState,
  addAgentToState,
  updatePassageMap,
  updateAgentField,
  removeAgentFromState,
} from "./state.js";

describe("state operations", () => {
  it("creates an empty state", () => {
    const state = createEmptyState();
    expect(state.stateVersion).toBe(STATE_SCHEMA_VERSION);
    expect(state.agents).toEqual({});
  });

  it("adds an agent to state", () => {
    const state = createEmptyState();
    const next = addAgentToState(state, "my-app", "agent-123", "2026-01-01T00:00:00.000Z");
    expect(next.agents["my-app"]).toBeDefined();
    expect(next.agents["my-app"].agentId).toBe("agent-123");
    expect(next.agents["my-app"].repoName).toBe("my-app");
    expect(next.agents["my-app"].passages).toEqual({});
    expect(next.agents["my-app"].lastBootstrap).toBeNull();
  });

  it("does not mutate original state", () => {
    const state = createEmptyState();
    addAgentToState(state, "my-app", "agent-123", "2026-01-01T00:00:00.000Z");
    expect(state.agents).toEqual({});
  });

  it("updates passage map for an agent", () => {
    let state = createEmptyState();
    state = addAgentToState(state, "my-app", "agent-123", "2026-01-01T00:00:00.000Z");
    const passages = { "src/index.ts": ["p1", "p2"], "src/utils.ts": ["p3"] };
    const next = updatePassageMap(state, "my-app", passages);
    expect(next.agents["my-app"].passages).toEqual(passages);
  });

  it("throws when updating passages for unknown agent", () => {
    const state = createEmptyState();
    expect(() => updatePassageMap(state, "nope", {})).toThrow("No agent found for repo: nope");
  });

  it("updates agent fields immutably", () => {
    let state = createEmptyState();
    state = addAgentToState(state, "my-app", "agent-123", "2026-01-01T00:00:00.000Z");
    const next = updateAgentField(state, "my-app", { lastSyncCommit: "abc123", lastSyncAt: "2026-02-01T00:00:00.000Z" });
    expect(next.agents["my-app"].lastSyncCommit).toBe("abc123");
    expect(next.agents["my-app"].lastSyncAt).toBe("2026-02-01T00:00:00.000Z");
    // original unchanged
    expect(state.agents["my-app"].lastSyncCommit).toBeNull();
  });

  it("throws when updating fields for unknown agent", () => {
    const state = createEmptyState();
    expect(() => updateAgentField(state, "nope", { lastSyncCommit: "abc" })).toThrow("No agent found for repo: nope");
  });

  it("removes an agent from state", () => {
    let state = createEmptyState();
    state = addAgentToState(state, "my-app", "agent-123", "2026-01-01T00:00:00.000Z");
    const next = removeAgentFromState(state, "my-app");
    expect(next.agents["my-app"]).toBeUndefined();
  });
});
