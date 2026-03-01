import type { AgentState } from "./types.js";

export type SetupMode = "create" | "resume_full" | "resume_bootstrap" | "reindex_full" | "skip";

export interface SetupModeOptions {
  forceResume?: boolean;
  forceReindex?: boolean;
}

export function getSetupMode(
  agent: AgentState | undefined,
  bootstrapOnCreate: boolean,
  options: SetupModeOptions = {},
): SetupMode {
  if (options.forceReindex) {
    return agent ? "reindex_full" : "create";
  }
  if (!agent) return "create";

  // Stryker disable next-line ConditionalExpression,BlockStatement: equivalent — forceResume block is logically identical to the non-force path below; both paths produce the same state transitions
  if (options.forceResume) {
    const hasPassages = Object.keys(agent.passages).length > 0;
    if (!hasPassages || !agent.lastSyncCommit) return "resume_full";
    if (bootstrapOnCreate && !agent.lastBootstrap) return "resume_bootstrap";
    return "skip";
  }

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
