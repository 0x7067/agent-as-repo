import { describe, expect, it } from "vitest";
import type { AgentState } from "./types.js";
import { buildPostSetupNextSteps, getSetupMode } from "./setup.js";

function makeAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    agentId: "agent-1",
    repoName: "my-app",
    passages: {},
    lastBootstrap: null,
    lastSyncCommit: null,
    lastSyncAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("getSetupMode", () => {
  it("returns create when no agent exists", () => {
    expect(getSetupMode(undefined, false)).toBe("create");
  });

  it("returns resume_full when agent exists but has no passages", () => {
    const agent = makeAgent();
    expect(getSetupMode(agent, false)).toBe("resume_full");
  });

  it("returns resume_full when passages exist but sync commit is missing", () => {
    const agent = makeAgent({
      passages: { "src/a.ts": ["p-1"] },
      lastSyncCommit: null,
    });
    expect(getSetupMode(agent, false)).toBe("resume_full");
  });

  it("returns resume_bootstrap when indexing is complete but bootstrap is missing", () => {
    const agent = makeAgent({
      passages: { "src/a.ts": ["p-1"] },
      lastSyncCommit: "abc123",
      lastBootstrap: null,
    });
    expect(getSetupMode(agent, true)).toBe("resume_bootstrap");
  });

  it("returns skip when agent is fully set up and bootstrap is not required", () => {
    const agent = makeAgent({
      passages: { "src/a.ts": ["p-1"] },
      lastSyncCommit: "abc123",
    });
    expect(getSetupMode(agent, false)).toBe("skip");
  });

  it("returns skip when agent is fully set up including bootstrap", () => {
    const agent = makeAgent({
      passages: { "src/a.ts": ["p-1"] },
      lastSyncCommit: "abc123",
      lastBootstrap: "2026-01-01T00:10:00.000Z",
    });
    expect(getSetupMode(agent, true)).toBe("skip");
  });
});

describe("buildPostSetupNextSteps", () => {
  it("includes first-run next steps with a concrete repo example", () => {
    const lines = buildPostSetupNextSteps("mobile-app");
    expect(lines).toContain("Next steps:");
    expect(lines).toContain('  repo-expert ask mobile-app "How does auth work?"');
    expect(lines).toContain("  repo-expert onboard mobile-app");
    expect(lines).toContain("  repo-expert doctor");
    expect(lines).toContain("  repo-expert sync");
  });
});
