import * as fs from "fs/promises";
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

export async function loadState(filePath: string): Promise<AppState> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const raw: unknown = JSON.parse(content);
    return appStateSchema.parse(raw);
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT") {
      return createEmptyState();
    }
    if (err instanceof SyntaxError || err instanceof z.ZodError) {
      console.warn(`Warning: invalid state file at ${filePath}, returning empty state`);
      return createEmptyState();
    }
    throw err;
  }
}

export async function saveState(filePath: string, state: AppState): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}
