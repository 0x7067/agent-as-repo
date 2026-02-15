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
    };

    const lines = formatAgentStatus(data);

    expect(lines).toContain("my-app");
    expect(lines).toContain("agent-abc");
    expect(lines).toContain("42");
    expect(lines).toContain("persona");
    expect(lines).toContain("120/5000");
    expect(lines).toContain("architecture");
    expect(lines).toContain("3200/5000");
    expect(lines).toContain("abc1234");
  });

  it("shows 'never' for null bootstrap and sync", () => {
    const data: AgentStatusData = {
      repoName: "my-app",
      agentId: "agent-abc",
      passageCount: 0,
      blocks: [],
      lastBootstrap: null,
      lastSyncCommit: null,
    };

    const lines = formatAgentStatus(data);

    expect(lines).toContain("never");
  });
});
