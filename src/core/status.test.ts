import { describe, it, expect } from "vitest";
import { formatAgentStatus, type AgentStatusData } from "./status.js";

describe("formatAgentStatus", () => {
  it("formats full agent status with all fields", () => {
    const data: AgentStatusData = {
      repoName: "my-app",
      agentId: "agent-abc",
      passageCount: 42,
      blocks: [
        { label: "persona", chars: 120, limit: 5000 },
        { label: "architecture", chars: 3200, limit: 5000 },
        { label: "conventions", chars: 800, limit: 5000 },
      ],
      lastBootstrap: "2026-01-15T10:00:00.000Z",
      lastSyncCommit: "abc1234",
      lastSyncAt: "2026-01-15T10:05:00.000Z",
    };

    const output = formatAgentStatus(data);

    expect(output).toContain("my-app:");
    expect(output).toContain("agent: agent-abc");
    expect(output).toContain("passages: 42");
    expect(output).toContain("memory blocks:");
    expect(output).toContain("persona: 120/5000 chars");
    expect(output).toContain("architecture: 3200/5000 chars");
    expect(output).toContain("last bootstrap: 2026-01-15T10:00:00.000Z");
    expect(output).toContain("last sync: abc1234");
    expect(output).toContain("last sync at: 2026-01-15T10:05:00.000Z");
  });

  it("uses newline as line separator", () => {
    const data: AgentStatusData = {
      repoName: "my-app",
      agentId: "agent-abc",
      passageCount: 0,
      blocks: [],
      lastBootstrap: null,
      lastSyncCommit: null,
      lastSyncAt: null,
    };
    const output = formatAgentStatus(data);
    expect(output).toContain("\n");
    const lines = output.split("\n");
    expect(lines.length).toBeGreaterThan(1);
  });

  it("omits memory blocks section when blocks array is empty", () => {
    const data: AgentStatusData = {
      repoName: "my-app",
      agentId: "agent-abc",
      passageCount: 0,
      blocks: [],
      lastBootstrap: null,
      lastSyncCommit: null,
      lastSyncAt: null,
    };

    const output = formatAgentStatus(data);
    expect(output).not.toContain("memory blocks:");
  });

  it("shows 'never' for each null field individually", () => {
    const data: AgentStatusData = {
      repoName: "my-app",
      agentId: "agent-abc",
      passageCount: 0,
      blocks: [],
      lastBootstrap: null,
      lastSyncCommit: null,
      lastSyncAt: null,
    };

    const output = formatAgentStatus(data);

    expect(output).toContain("last bootstrap: never");
    expect(output).toContain("last sync: never");
    expect(output).toContain("last sync at: never");
  });

  it("shows actual values instead of 'never' when fields are set", () => {
    const data: AgentStatusData = {
      repoName: "my-app",
      agentId: "agent-abc",
      passageCount: 0,
      blocks: [],
      lastBootstrap: "2026-01-01",
      lastSyncCommit: "abc123",
      lastSyncAt: "2026-01-02",
    };

    const output = formatAgentStatus(data);

    expect(output).toContain("last bootstrap: 2026-01-01");
    expect(output).not.toContain("last bootstrap: never");
    expect(output).toContain("last sync: abc123");
    expect(output).toContain("last sync at: 2026-01-02");
  });
});
