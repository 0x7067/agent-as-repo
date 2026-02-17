import { describe, expect, it } from "vitest";
import {
  computeEvalSummary,
  evaluateTaskResponse,
  formatEvalReport,
  parseEvalTasks,
  type EvalTask,
} from "./eval.js";

describe("eval core", () => {
  it("parses tasks from top-level tasks object", () => {
    const parsed = parseEvalTasks({
      tasks: [
        {
          id: "t1",
          input: "How does auth work?",
          checks: {
            correct: { must_include: ["token"], must_not_include: ["oauth2"] },
          },
        },
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("t1");
  });

  it("scores dimensions based on include/exclude checks", () => {
    const task: EvalTask = {
      id: "t1",
      input: "question",
      checks: {
        correct: { mustInclude: ["ok"], mustNotInclude: ["bad"] },
        grounded: { mustInclude: ["source"], mustNotInclude: [] },
      },
    };
    const result = evaluateTaskResponse(task, "ok with source");
    expect(result.dimensions.correct.pass).toBe(true);
    expect(result.dimensions.grounded.pass).toBe(true);
    expect(result.overallPass).toBe(true);
  });

  it("aggregates summary metrics and formats report", () => {
    const results = [
      evaluateTaskResponse(
        { id: "a", input: "x", checks: { correct: { mustInclude: ["ok"], mustNotInclude: [] } } },
        "ok",
      ),
      evaluateTaskResponse(
        { id: "b", input: "y", checks: { correct: { mustInclude: ["ok"], mustNotInclude: [] } } },
        "missing",
      ),
    ];
    const summary = computeEvalSummary(results);
    expect(summary.totalTasks).toBe(2);
    expect(summary.overallPassRate).toBe(50);
    const report = formatEvalReport({ results, summary });
    expect(report).toContain("Total tasks: 2");
    expect(report).toContain("Overall pass rate: 50%");
  });
});
