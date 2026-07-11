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

/**
 * Override a computed setup mode when the state file claims an agent exists
 * but the passage store has no row for it (store wiped, `REPO_EXPERT_DATA_DIR`
 * changed, etc.). Self-heals by forcing a full "create" pass — which
 * recreates the agent record and reindexes from scratch — instead of trusting
 * the state file and silently skipping (or resuming into a store that will
 * never actually hold the agent). Pure function: the actual store check is
 * the shell's job; this just decides what to do with the answer.
 */
export function resolveEffectiveSetupMode(mode: SetupMode, existsInStore: boolean): SetupMode {
  if (mode === "create" || existsInStore) return mode;
  return "create";
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
