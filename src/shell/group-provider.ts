/**
 * Multi-agent orchestration — client-side patterns.
 *
 * The Letta Groups API is **deprecated** in the v1.0 SDK and absent from
 * @letta-ai/letta-client. The recommended alternatives are:
 *
 *   1. **Built-in messaging tools** (already supported via `tools` config):
 *      - `send_message_to_agent_and_wait_for_reply` — synchronous cross-agent query
 *      - `send_message_to_agent_async` — fire-and-forget messaging
 *      - `send_message_to_agents_matching_all_tags` — broadcast to tagged agents
 *      Attach ONE of sync/async per agent (not both). Tag-based discovery is preferred.
 *
 *   2. **Client-side orchestration** — application code manages turn-taking,
 *      routing, and aggregation using the existing `AgentProvider.sendMessage`.
 *
 * The types below define client-side orchestration patterns that can be
 * implemented on top of `AgentProvider` without any Groups API dependency.
 */

import type { AgentProvider } from "./provider.js";

/** Round-robin: cycle through agents in order. */
export interface RoundRobinConfig {
  type: "round_robin";
  agentIds: string[];
  maxTurns: number;
}

/** Supervisor: a manager fans out to workers and aggregates results. */
export interface SupervisorConfig {
  type: "supervisor";
  managerAgentId: string;
  workerAgentIds: string[];
}

/** Dynamic: a router agent decides which agent handles each message. */
export interface DynamicRouterConfig {
  type: "dynamic";
  routerAgentId: string;
  agentIds: string[];
  maxTurns: number;
}

export type OrchestrationConfig = RoundRobinConfig | SupervisorConfig | DynamicRouterConfig;

/**
 * Client-side round-robin: sends user content to each agent in sequence,
 * collecting all responses.
 */
export async function roundRobin(
  provider: AgentProvider,
  config: RoundRobinConfig,
  content: string,
): Promise<string[]> {
  const responses: string[] = [];
  const turns = Math.min(config.maxTurns, config.agentIds.length);
  for (let i = 0; i < turns; i++) {
    const agentId = config.agentIds[i % config.agentIds.length];
    const resp = await provider.sendMessage(agentId, content);
    responses.push(resp);
  }
  return responses;
}

/**
 * Client-side supervisor: sends content to all workers in parallel,
 * then has the manager summarize/aggregate the worker responses.
 */
export interface BroadcastAgent {
  repoName: string;
  agentId: string;
}

export interface BroadcastResult {
  repoName: string;
  response: string | null;
  error: string | null;
}

export interface BroadcastOptions {
  timeoutMs?: number;
}

/**
 * Broadcast a question to multiple agents in parallel with per-agent timeout.
 * Returns results for all agents, including those that timed out or errored.
 */
export async function broadcastAsk(
  provider: AgentProvider,
  agents: BroadcastAgent[],
  question: string,
  options: BroadcastOptions = {},
): Promise<BroadcastResult[]> {
  const timeoutMs = options.timeoutMs ?? 30_000;

  return Promise.all(
    agents.map(async ({ repoName, agentId }): Promise<BroadcastResult> => {
      try {
        const response = await Promise.race([
          provider.sendMessage(agentId, question),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Agent "${repoName}" timed out after ${timeoutMs}ms`)), timeoutMs),
          ),
        ]);
        return { repoName, response, error: null };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { repoName, response: null, error: message };
      }
    }),
  );
}

export async function supervisorFanOut(
  provider: AgentProvider,
  config: SupervisorConfig,
  content: string,
): Promise<string> {
  const workerResponses = await Promise.all(
    config.workerAgentIds.map((id) => provider.sendMessage(id, content)),
  );

  const summary = workerResponses.map((r, i) => `[Agent ${i + 1}]: ${r}`).join("\n\n");
  const managerPrompt = `You received the following responses from worker agents:\n\n${summary}\n\nSummarize and synthesize their findings.`;
  return provider.sendMessage(config.managerAgentId, managerPrompt);
}
