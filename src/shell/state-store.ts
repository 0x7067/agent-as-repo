import * as fs from "fs/promises";
import { createEmptyState } from "../core/state.js";
import type { AppState } from "../core/types.js";

export async function loadState(filePath: string): Promise<AppState> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as AppState;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return createEmptyState();
    }
    throw err;
  }
}

export async function saveState(filePath: string, state: AppState): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}
