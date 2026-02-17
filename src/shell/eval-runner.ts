import * as fs from "fs/promises";
import { computeEvalSummary, evaluateTaskResponse, parseEvalTasks, type EvalRun, type EvalTaskResult } from "../core/eval.js";
import type { AgentProvider } from "./provider.js";

export interface RunEvalParams {
  provider: AgentProvider;
  agentId: string;
  filePath: string;
  maxTasks?: number;
}

function clampMaxTasks(maxTasks: number | undefined, taskCount: number): number {
  if (maxTasks === undefined) return taskCount;
  if (maxTasks < 0) return taskCount;
  return Math.min(maxTasks, taskCount);
}

export async function runEvalFromFile(params: RunEvalParams): Promise<EvalRun> {
  const raw = await fs.readFile(params.filePath, "utf-8");
  const tasks = parseEvalTasks(JSON.parse(raw));
  const limit = clampMaxTasks(params.maxTasks, tasks.length);
  const selectedTasks = tasks.slice(0, limit);

  const results: EvalTaskResult[] = [];
  for (const task of selectedTasks) {
    const response = await params.provider.sendMessage(params.agentId, task.input);
    results.push(evaluateTaskResponse(task, response));
  }

  return {
    results,
    summary: computeEvalSummary(results),
  };
}
