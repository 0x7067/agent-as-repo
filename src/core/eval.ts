import { z } from "zod/v4";

export const EVAL_DIMENSIONS = ["correct", "grounded", "useful", "formatFollowed"] as const;
export type EvalDimension = typeof EVAL_DIMENSIONS[number];

export interface EvalRuleSet {
  mustInclude: string[];
  mustNotInclude: string[];
}

export interface EvalTask {
  id: string;
  input: string;
  checks: Partial<Record<EvalDimension, EvalRuleSet>>;
}

export interface EvalDimensionResult {
  pass: boolean;
  checked: boolean;
  missing: string[];
  forbidden: string[];
}

export interface EvalTaskResult {
  taskId: string;
  input: string;
  response: string;
  dimensions: Record<EvalDimension, EvalDimensionResult>;
  overallPass: boolean;
}

export interface EvalSummary {
  totalTasks: number;
  passedTasks: number;
  overallPassRate: number;
  dimensionPassRate: Record<EvalDimension, number>;
}

export interface EvalRun {
  results: EvalTaskResult[];
  summary: EvalSummary;
}

const ruleSetSchema = z.object({
  must_include: z.array(z.string()).optional().default([]),
  must_not_include: z.array(z.string()).optional().default([]),
});

const checksSchema = z.object({
  correct: ruleSetSchema.optional(),
  grounded: ruleSetSchema.optional(),
  useful: ruleSetSchema.optional(),
  format_followed: ruleSetSchema.optional(),
});

const taskSchema = z.object({
  id: z.string().min(1),
  input: z.string().min(1),
  checks: checksSchema.optional().default({}),
});

const taskFileSchema = z.union([
  z.array(taskSchema),
  z.object({
    tasks: z.array(taskSchema),
  }),
]);

function toPercent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function normalize(text: string): string {
  return text.toLowerCase();
}

function scoreRuleSet(response: string, rules?: EvalRuleSet): EvalDimensionResult {
  if (!rules) return { pass: true, checked: false, missing: [], forbidden: [] };

  const haystack = normalize(response);
  const missing = rules.mustInclude.filter((item) => !haystack.includes(normalize(item)));
  const forbidden = rules.mustNotInclude.filter((item) => haystack.includes(normalize(item)));
  return {
    pass: missing.length === 0 && forbidden.length === 0,
    checked: rules.mustInclude.length > 0 || rules.mustNotInclude.length > 0,
    missing,
    forbidden,
  };
}

function convertRules(raw?: z.infer<typeof ruleSetSchema>): EvalRuleSet | undefined {
  if (!raw) return undefined;
  return {
    mustInclude: raw.must_include,
    mustNotInclude: raw.must_not_include,
  };
}

export function parseEvalTasks(raw: unknown): EvalTask[] {
  const parsed = taskFileSchema.parse(raw);
  const tasks = Array.isArray(parsed) ? parsed : parsed.tasks;

  return tasks.map((task) => ({
    id: task.id,
    input: task.input,
    checks: {
      correct: convertRules(task.checks.correct),
      grounded: convertRules(task.checks.grounded),
      useful: convertRules(task.checks.useful),
      formatFollowed: convertRules(task.checks.format_followed),
    },
  }));
}

export function evaluateTaskResponse(task: EvalTask, response: string): EvalTaskResult {
  const dimensions: Record<EvalDimension, EvalDimensionResult> = {
    correct: scoreRuleSet(response, task.checks.correct),
    grounded: scoreRuleSet(response, task.checks.grounded),
    useful: scoreRuleSet(response, task.checks.useful),
    formatFollowed: scoreRuleSet(response, task.checks.formatFollowed),
  };
  const overallPass = EVAL_DIMENSIONS.every((dimension) => dimensions[dimension].pass);

  return {
    taskId: task.id,
    input: task.input,
    response,
    dimensions,
    overallPass,
  };
}

export function computeEvalSummary(results: EvalTaskResult[]): EvalSummary {
  const totalTasks = results.length;
  const passedTasks = results.filter((result) => result.overallPass).length;

  const dimensionPassRate: Record<EvalDimension, number> = {
    correct: toPercent(results.filter((result) => result.dimensions.correct.pass).length, totalTasks),
    grounded: toPercent(results.filter((result) => result.dimensions.grounded.pass).length, totalTasks),
    useful: toPercent(results.filter((result) => result.dimensions.useful.pass).length, totalTasks),
    formatFollowed: toPercent(results.filter((result) => result.dimensions.formatFollowed.pass).length, totalTasks),
  };

  return {
    totalTasks,
    passedTasks,
    overallPassRate: toPercent(passedTasks, totalTasks),
    dimensionPassRate,
  };
}

export function formatEvalReport(run: EvalRun): string {
  const lines: string[] = [];
  lines.push("Evaluation results:");
  lines.push(`  Total tasks: ${run.summary.totalTasks}`);
  lines.push(`  Passed tasks: ${run.summary.passedTasks}`);
  lines.push(`  Overall pass rate: ${run.summary.overallPassRate}%`);
  lines.push(`  Correct pass rate: ${run.summary.dimensionPassRate.correct}%`);
  lines.push(`  Grounded pass rate: ${run.summary.dimensionPassRate.grounded}%`);
  lines.push(`  Useful pass rate: ${run.summary.dimensionPassRate.useful}%`);
  lines.push(`  Format pass rate: ${run.summary.dimensionPassRate.formatFollowed}%`);

  const failed = run.results.filter((result) => !result.overallPass);
  if (failed.length > 0) {
    lines.push("");
    lines.push("Failed tasks:");
    for (const result of failed) {
      lines.push(`  - ${result.taskId}`);
    }
  }

  return lines.join("\n");
}
