import type { AgentState } from "./types.js";

export type SetupMode = "create" | "resume_full" | "resume_bootstrap" | "skip";

export function getSetupMode(agent: AgentState | undefined, bootstrapOnCreate: boolean): SetupMode {
  if (!agent) return "create";

  const hasPassages = Object.keys(agent.passages).length > 0;
  if (!hasPassages) return "resume_full";

  if (!agent.lastSyncCommit) return "resume_full";

  if (bootstrapOnCreate && !agent.lastBootstrap) return "resume_bootstrap";

  return "skip";
}

export function buildPostSetupNextSteps(exampleRepoName: string): string[] {
  return [
    "Next steps:",
    "  repo-expert doctor",
    `  repo-expert ask ${exampleRepoName} "How does auth work?"`,
    `  repo-expert onboard ${exampleRepoName}`,
    "  repo-expert sync",
  ];
}
