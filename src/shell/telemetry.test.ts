import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { beginCommandTelemetry, endCommandTelemetry, recordCommandRetry, resetTelemetryForTests } from "./telemetry.js";

const ORIGINAL_TELEMETRY_PATH = process.env.REPO_EXPERT_TELEMETRY_PATH;

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

beforeEach(() => {
  resetTelemetryForTests();
  delete process.env.REPO_EXPERT_TELEMETRY_PATH;
});

afterEach(() => {
  resetTelemetryForTests();
  if (ORIGINAL_TELEMETRY_PATH === undefined) {
    delete process.env.REPO_EXPERT_TELEMETRY_PATH;
  } else {
    process.env.REPO_EXPERT_TELEMETRY_PATH = ORIGINAL_TELEMETRY_PATH;
  }
});

describe("telemetry", () => {
  it("does nothing when telemetry path is not configured", async () => {
    beginCommandTelemetry("setup");
    recordCommandRetry();
    endCommandTelemetry("ok");

    const dir = await makeTempDir("repo-expert-telemetry-disabled-");
    const missingPath = path.join(dir, "telemetry.jsonl");
    await expect(fs.access(missingPath)).rejects.toThrow();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes one JSONL event per command run", async () => {
    const dir = await makeTempDir("repo-expert-telemetry-events-");
    const filePath = path.join(dir, "telemetry.jsonl");
    process.env.REPO_EXPERT_TELEMETRY_PATH = filePath;

    beginCommandTelemetry("setup");
    recordCommandRetry();
    recordCommandRetry();
    endCommandTelemetry("ok");

    const lines = (await fs.readFile(filePath, "utf-8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0]) as {
      command: string;
      status: string;
      retryCount: number;
      durationMs: number;
      startedAt: string;
      finishedAt: string;
    };
    expect(event.command).toBe("setup");
    expect(event.status).toBe("ok");
    expect(event.retryCount).toBe(2);
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
    expect(new Date(event.finishedAt).getTime()).toBeGreaterThanOrEqual(new Date(event.startedAt).getTime());

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("records error class and ignores duplicate end calls", async () => {
    const dir = await makeTempDir("repo-expert-telemetry-errors-");
    const filePath = path.join(dir, "telemetry.jsonl");
    process.env.REPO_EXPERT_TELEMETRY_PATH = filePath;

    beginCommandTelemetry("sync");
    endCommandTelemetry("error", "TimeoutError");
    endCommandTelemetry("error", "ShouldNotBeWritten");

    const lines = (await fs.readFile(filePath, "utf-8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0]) as { status: string; errorClass?: string };
    expect(event.status).toBe("error");
    expect(event.errorClass).toBe("TimeoutError");

    await fs.rm(dir, { recursive: true, force: true });
  });
});
