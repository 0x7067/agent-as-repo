import * as path from "path";
import * as fs from "fs/promises";
import { execFileSync } from "child_process";
import { loadState, saveState } from "./state-store.js";
import { collectFiles } from "./file-collector.js";
import { syncRepo } from "./sync.js";
import { shouldSync, formatSyncLog } from "../core/watch.js";
import { updateAgentField } from "../core/state.js";
import { shouldIncludeFile } from "../core/filter.js";
import type { AgentProvider } from "./provider.js";
import type { AgentState, Config, FileInfo } from "../core/types.js";

export interface WatchParams {
  provider: AgentProvider;
  config: Config;
  repoNames: string[];
  statePath: string;
  intervalMs: number;
  signal: AbortSignal;
  log?: (msg: string) => void;
}

function gitHeadCommit(cwd: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();
  } catch {
    return null;
  }
}

function gitDiffFiles(cwd: string, sinceRef: string): string[] | null {
  try {
    const diff = execFileSync("git", ["diff", "--name-only", `${sinceRef}..HEAD`], {
      cwd,
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();
    return diff ? diff.split("\n") : [];
  } catch {
    return null;
  }
}

async function updateAndSaveState(
  statePath: string,
  repoName: string,
  updates: Partial<Omit<AgentState, "agentId" | "repoName" | "createdAt">>,
): Promise<void> {
  const freshState = await loadState(statePath);
  await saveState(statePath, updateAgentField(freshState, repoName, { ...updates, lastSyncAt: new Date().toISOString() }));
}

async function collectFile(repoPath: string, filePath: string): Promise<FileInfo | null> {
  const absPath = path.join(repoPath, filePath);
  try {
    const content = await fs.readFile(absPath, "utf-8");
    const stat = await fs.stat(absPath);
    return { path: filePath, content, sizeKb: stat.size / 1024 };
  } catch {
    return null;
  }
}

export async function watchRepos(params: WatchParams): Promise<void> {
  const { provider, config, repoNames, statePath, intervalMs, signal, log = console.log } = params;
  const syncing = new Set<string>();
  let activeTick: Promise<void> = Promise.resolve();

  async function tick(): Promise<void> {
    const state = await loadState(statePath);

    for (const repoName of repoNames) {
      if (signal.aborted) return;
      if (syncing.has(repoName)) continue;

      const agentInfo = state.agents[repoName];
      if (!agentInfo) continue;

      const repoConfig = config.repos[repoName];
      if (!repoConfig) continue;

      const currentHead = gitHeadCommit(repoConfig.path);
      if (!currentHead) continue;

      if (!shouldSync(agentInfo.lastSyncCommit, currentHead)) continue;

      syncing.add(repoName);
      try {
        const start = Date.now();

        let changedFiles: string[];
        if (agentInfo.lastSyncCommit) {
          const diffResult = gitDiffFiles(repoConfig.path, agentInfo.lastSyncCommit);
          if (diffResult === null) {
            log(`[${repoName}] git diff failed, skipping`);
            continue;
          }
          changedFiles = diffResult.filter((f) => shouldIncludeFile(f, 0, repoConfig));
        } else {
          const files = await collectFiles(repoConfig);
          changedFiles = files.map((f) => f.path);
        }

        if (changedFiles.length === 0) {
          // HEAD changed but no file diff (e.g., merge commit) — update state
          await updateAndSaveState(statePath, repoName, { lastSyncCommit: currentHead });
          log(formatSyncLog(repoName, agentInfo.lastSyncCommit, currentHead, 0, Date.now() - start));
          continue;
        }

        const result = await syncRepo({
          provider,
          agent: agentInfo,
          changedFiles,
          collectFile: (filePath) => collectFile(repoConfig.path, filePath),
          headCommit: currentHead,
        });

        // Re-read state (may have been updated by another command)
        await updateAndSaveState(statePath, repoName, {
          passages: result.passages,
          lastSyncCommit: result.lastSyncCommit,
        });

        log(formatSyncLog(repoName, agentInfo.lastSyncCommit, currentHead, changedFiles.length, Date.now() - start));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`[${repoName}] sync error: ${msg}`);
      } finally {
        syncing.delete(repoName);
      }
    }
  }

  // Run first tick immediately
  await tick();

  // Poll loop
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timer = setInterval(() => {
      if (signal.aborted) {
        clearInterval(timer);
        return;
      }
      activeTick = tick();
    }, intervalMs);

    signal.addEventListener("abort", async () => {
      clearInterval(timer);
      await activeTick;
      resolve();
    }, { once: true });
  });
}
