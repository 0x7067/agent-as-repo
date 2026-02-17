import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod/v4";
import { createEmptyState } from "../core/state.js";
import type { AppState } from "../core/types.js";

const passageMapSchema = z.record(z.string(), z.array(z.string()));

const agentStateSchema = z.object({
  agentId: z.string(),
  repoName: z.string(),
  passages: passageMapSchema.optional().default({}),
  lastBootstrap: z.string().nullable().optional().default(null),
  lastSyncCommit: z.string().nullable().optional().default(null),
  lastSyncAt: z.string().nullable().optional().default(null),
  createdAt: z.string().optional().default(""),
});

const appStateSchema = z.object({
  agents: z.record(z.string(), agentStateSchema).optional().default({}),
});

export class StateFileError extends Error {
  readonly filePath: string;

  constructor(filePath: string, details: string) {
    super(`Invalid state file at ${filePath}: ${details}. Please remove or fix it, then re-run your command.`);
    this.name = "StateFileError";
    this.filePath = filePath;
  }
}

export async function loadState(filePath: string): Promise<AppState> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const raw: unknown = JSON.parse(content);
    return appStateSchema.parse(raw);
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT") {
      return createEmptyState();
    }
    if (err instanceof SyntaxError) {
      throw new StateFileError(filePath, err.message);
    }
    if (err instanceof z.ZodError) {
      const issue = err.issues[0];
      const location = issue?.path?.join(".") || "root";
      throw new StateFileError(filePath, `schema error at "${location}": ${issue?.message ?? "invalid value"}`);
    }
    throw err;
  }
}

export async function saveState(filePath: string, state: AppState): Promise<void> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(dir, `.${base}.tmp.${process.pid}.${Date.now()}`);

  await fs.writeFile(tempPath, JSON.stringify(state, null, 2), "utf-8");
  await fs.rename(tempPath, filePath);
}
