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

  it("returns create for --reindex when no agent exists", () => {
    expect(getSetupMode(undefined, false, { forceReindex: true })).toBe("create");
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

  it("returns reindex_full when --reindex is requested on existing agent", () => {
    const agent = makeAgent({
      passages: { "src/a.ts": ["p-1"] },
      lastSyncCommit: "abc123",
    });
    expect(getSetupMode(agent, false, { forceReindex: true })).toBe("reindex_full");
  });

  it("forceResume with no passages returns resume_full", () => {
    const agent = makeAgent();
    expect(getSetupMode(agent, false, { forceResume: true })).toBe("resume_full");
  });

  it("forceResume with passages but no sync commit returns resume_full", () => {
    const agent = makeAgent({
      passages: { "src/a.ts": ["p-1"] },
      lastSyncCommit: null,
    });
    expect(getSetupMode(agent, true, { forceResume: true })).toBe("resume_full");
  });

  it("forceResume with passages and sync but no bootstrap returns resume_bootstrap", () => {
    const agent = makeAgent({
      passages: { "src/a.ts": ["p-1"] },
      lastSyncCommit: "abc123",
      lastBootstrap: null,
    });
    expect(getSetupMode(agent, true, { forceResume: true })).toBe("resume_bootstrap");
  });

  it("forceResume with everything complete returns skip", () => {
    const agent = makeAgent({
      passages: { "src/a.ts": ["p-1"] },
      lastSyncCommit: "abc123",
      lastBootstrap: "2026-01-01",
    });
    expect(getSetupMode(agent, true, { forceResume: true })).toBe("skip");
  });

  it("forceResume without bootstrap requirement and complete returns skip", () => {
    const agent = makeAgent({
      passages: { "src/a.ts": ["p-1"] },
      lastSyncCommit: "abc123",
    });
    expect(getSetupMode(agent, false, { forceResume: true })).toBe("skip");
  });

  it("forceResume block differs from non-force path", () => {
    // Agent with passages, sync commit, bootstrap required but missing
    // forceResume: both paths should return resume_bootstrap
    // But with forceResume, the block's hasPassages check uses length > 0 independently
    const agent = makeAgent({
      passages: { "src/a.ts": ["p-1"] },
      lastSyncCommit: "abc123",
      lastBootstrap: null,
    });
    // Without forceResume
    expect(getSetupMode(agent, true)).toBe("resume_bootstrap");
    // With forceResume — should also be resume_bootstrap
    expect(getSetupMode(agent, true, { forceResume: true })).toBe("resume_bootstrap");
  });

  it("non-force path with no passages returns resume_full (not affected by forceResume)", () => {
    const agent = makeAgent({ passages: {} });
    // Without forceResume — hits line 28 (non-force hasPassages check)
    expect(getSetupMode(agent, false)).toBe("resume_full");
    // With forceResume — hits line 21 (force hasPassages check)
    expect(getSetupMode(agent, false, { forceResume: true })).toBe("resume_full");
  });

  it("non-force path with passages but no sync commit returns resume_full", () => {
    const agent = makeAgent({
      passages: { "src/a.ts": ["p-1"] },
      lastSyncCommit: null,
    });
    expect(getSetupMode(agent, false)).toBe("resume_full");
  });

  it("non-force path skips resume_full when passages exist (hasPassages > 0, not >= 0)", () => {
    const agent = makeAgent({
      passages: { "src/a.ts": ["p-1"] },
      lastSyncCommit: "abc123",
    });
    // With passages AND sync commit — should skip, NOT resume_full
    expect(getSetupMode(agent, false)).toBe("skip");
  });

  it("forceResume with no passages but sync commit returns resume_full", () => {
    const agent = makeAgent({ passages: {}, lastSyncCommit: "abc123" });
    expect(getSetupMode(agent, false, { forceResume: true })).toBe("resume_full");
  });

  it("forceResume with empty passages and no sync returns resume_full", () => {
    const agent = makeAgent({ passages: {}, lastSyncCommit: null });
    expect(getSetupMode(agent, false, { forceResume: true })).toBe("resume_full");
  });

  it("non-force returns resume_full for empty passages regardless of other state", () => {
    const agent = makeAgent({
      passages: {},
      lastSyncCommit: "abc123",
      lastBootstrap: "2026-01-01",
    });
    expect(getSetupMode(agent, true)).toBe("resume_full");
  });

  it("non-force returns resume_full for empty passages with sync commit", () => {
    const agent = makeAgent({ passages: {}, lastSyncCommit: "abc123" });
    expect(getSetupMode(agent, false)).toBe("resume_full");
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
