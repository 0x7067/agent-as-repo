import * as fs from "fs";
import * as path from "path";

export type CommandTelemetryStatus = "ok" | "error";

export interface CommandTelemetryEvent {
  command: string;
  status: CommandTelemetryStatus;
  retryCount: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  errorClass?: string;
}

interface CommandTelemetryRun {
  command: string;
  startedAtMs: number;
  startedAtIso: string;
  retryCount: number;
}

let activeRun: CommandTelemetryRun | null = null;

function telemetryPath(): string | null {
  const configured = process.env.REPO_EXPERT_TELEMETRY_PATH?.trim();
  return configured ? path.resolve(configured) : null;
}

function telemetryEnabled(): boolean {
  return telemetryPath() !== null;
}

export function beginCommandTelemetry(command: string): void {
  if (!telemetryEnabled()) return;
  activeRun = {
    command,
    startedAtMs: Date.now(),
    startedAtIso: new Date().toISOString(),
    retryCount: 0,
  };
}

export function recordCommandRetry(): void {
  if (!activeRun) return;
  activeRun.retryCount++;
}

export function endCommandTelemetry(status: CommandTelemetryStatus, errorClass?: string): void {
  const run = activeRun;
  activeRun = null;
  if (!run) return;

  const filePath = telemetryPath();
  if (!filePath) return;

  const finishedAtMs = Date.now();
  const event: CommandTelemetryEvent = {
    command: run.command,
    status,
    retryCount: run.retryCount,
    durationMs: Math.max(0, finishedAtMs - run.startedAtMs),
    startedAt: run.startedAtIso,
    finishedAt: new Date(finishedAtMs).toISOString(),
  };
  if (errorClass) {
    event.errorClass = errorClass;
  }

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf-8");
  } catch {
    // Telemetry must never break command execution.
  }
}

export function resetTelemetryForTests(): void {
  activeRun = null;
}
