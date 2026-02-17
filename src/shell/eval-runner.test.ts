import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { runEvalFromFile } from "./eval-runner.js";
import { makeMockProvider } from "./__test__/mock-provider.js";

async function withTempDir(prefix: string, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("eval runner", () => {
  it("runs tasks against provider and returns scored results", async () => {
    await withTempDir("repo-expert-eval-runner-", async (dir) => {
      const taskPath = path.join(dir, "tasks.json");
      await fs.writeFile(
        taskPath,
        JSON.stringify({
          tasks: [
            {
              id: "t1",
              input: "Question 1",
              checks: { correct: { must_include: ["ok"], must_not_include: [] } },
            },
          ],
        }),
        "utf-8",
      );

      const provider = makeMockProvider({
        sendMessage: async () => "ok",
      });
      const run = await runEvalFromFile({
        provider,
        agentId: "agent-1",
        filePath: taskPath,
      });
      expect(run.summary.totalTasks).toBe(1);
      expect(run.summary.overallPassRate).toBe(100);
      expect(run.results[0].response).toBe("ok");
    });
  });

  it("supports maxTasks limit", async () => {
    await withTempDir("repo-expert-eval-runner-limit-", async (dir) => {
      const taskPath = path.join(dir, "tasks.json");
      await fs.writeFile(
        taskPath,
        JSON.stringify({
          tasks: [
            { id: "t1", input: "Q1", checks: {} },
            { id: "t2", input: "Q2", checks: {} },
          ],
        }),
        "utf-8",
      );

      const provider = makeMockProvider({
        sendMessage: async () => "ok",
      });
      const run = await runEvalFromFile({
        provider,
        agentId: "agent-1",
        filePath: taskPath,
        maxTasks: 1,
      });
      expect(run.results).toHaveLength(1);
    });
  });
});
