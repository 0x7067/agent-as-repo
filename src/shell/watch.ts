import * as path from "path";
import * as fs from "fs/promises";
import { watch as fsWatch, type FSWatcher } from "fs";
import { execFileSync } from "child_process";
import { loadState, saveState } from "./state-store.js";
import { collectFiles } from "./file-collector.js";
import { syncRepo } from "./sync.js";
import { shouldSync, formatSyncLog } from "../core/watch.js";
import { updateAgentField } from "../core/state.js";
import { shouldIncludeFile } from "../core/filter.js";
import type { AgentProvider } from "./provider.js";
import type { AgentState, Config, FileInfo, RepoConfig } from "../core/types.js";

export interface WatchParams {
  provider: AgentProvider;
  config: Config;
  repoNames: string[];
  statePath: string;
  intervalMs: number;
  debounceMs?: number;
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

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function toAgentPath(repoConfig: RepoConfig, repoRelativePath: string): string | null {
  const normalized = normalizeRelativePath(repoRelativePath);
  if (!normalized) return null;
  if (!repoConfig.basePath) return normalized;

  const normalizedBase = normalizeRelativePath(repoConfig.basePath).replace(/\/+$/, "");
  if (normalized === normalizedBase) return null;
  if (!normalized.startsWith(`${normalizedBase}/`)) return null;
  return normalized.slice(normalizedBase.length + 1);
}

function filterChangedFiles(repoConfig: RepoConfig, changedFiles: string[]): string[] {
  return changedFiles
    .map((filePath) => toAgentPath(repoConfig, filePath))
    .filter((filePath): filePath is string => Boolean(filePath))
    .filter((filePath) => shouldIncludeFile(filePath, 0, repoConfig));
}

export async function watchRepos(params: WatchParams): Promise<void> {
  const {
    provider,
    config,
    repoNames,
    statePath,
    intervalMs,
    debounceMs = 250,
    signal,
    log = console.log,
  } = params;
  const syncing = new Set<string>();
  const pendingFilesByRepo = new Map<string, Set<string>>();
  const debounceTimers = new Map<string, NodeJS.Timeout>();
  const watchers: FSWatcher[] = [];
  const runningTasks = new Set<Promise<void>>();
  const ignoredEventFilesByRepo = new Map<string, Set<string>>();
  const ignoredAbsoluteEventFilesByRepo = new Map<string, Set<string>>();
  let activeTick: Promise<void> = Promise.resolve();

  function trackTask(task: Promise<void>): Promise<void> {
    runningTasks.add(task);
    task.finally(() => {
      runningTasks.delete(task);
    });
    return task;
  }

  function scheduleDebouncedSync(repoName: string, delayMs = debounceMs): void {
    const existing = debounceTimers.get(repoName);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      debounceTimers.delete(repoName);
      void trackTask(flushPending(repoName));
    }, Math.max(0, delayMs));
    debounceTimers.set(repoName, timer);
  }

  function queueFileChange(repoName: string, filePath: string): void {
    const repoConfig = config.repos[repoName];
    if (!repoConfig) return;
    if (ignoredEventFilesByRepo.get(repoName)?.has(filePath)) return;
    if (!shouldIncludeFile(filePath, 0, repoConfig)) return;

    const pending = pendingFilesByRepo.get(repoName) ?? new Set<string>();
    pending.add(filePath);
    pendingFilesByRepo.set(repoName, pending);
    scheduleDebouncedSync(repoName);
  }

  async function syncRepoNow(repoName: string, eventChangedFiles?: string[]): Promise<void> {
    if (signal.aborted) return;
    if (syncing.has(repoName)) return;

    const state = await loadState(statePath);
    const agentInfo = state.agents[repoName];
    if (!agentInfo) return;

    const repoConfig = config.repos[repoName];
    if (!repoConfig) return;

    const currentHead = gitHeadCommit(repoConfig.path);
    if (!currentHead) return;

    const isEventSync = Boolean(eventChangedFiles && eventChangedFiles.length > 0);
    if (!isEventSync && !shouldSync(agentInfo.lastSyncCommit, currentHead)) {
      log(`[${repoName}] no changes (HEAD=${currentHead.slice(0, 7)})`);
      return;
    }

    syncing.add(repoName);
    try {
      const start = Date.now();
      let changedFiles: string[];

      if (isEventSync) {
        changedFiles = (eventChangedFiles ?? []).filter((filePath) => shouldIncludeFile(filePath, 0, repoConfig));
      } else if (agentInfo.lastSyncCommit) {
        const diffResult = gitDiffFiles(repoConfig.path, agentInfo.lastSyncCommit);
        if (diffResult === null) {
          log(`[${repoName}] git diff failed, skipping`);
          return;
        }
        changedFiles = filterChangedFiles(repoConfig, diffResult);
      } else {
        const files = await collectFiles(repoConfig);
        changedFiles = files.map((f) => f.path);
      }

      changedFiles = Array.from(new Set(changedFiles));
      if (changedFiles.length === 0) {
        if (!isEventSync) {
          // HEAD changed but no indexable file diff (e.g., merge commit) — update state
          await updateAndSaveState(statePath, repoName, { lastSyncCommit: currentHead });
          log(formatSyncLog(repoName, agentInfo.lastSyncCommit, currentHead, 0, Date.now() - start));
        }
        return;
      }

      const result = await syncRepo({
        provider,
        agent: agentInfo,
        changedFiles,
        collectFile: (filePath) =>
          collectFile(
            repoConfig.basePath ? path.join(repoConfig.path, repoConfig.basePath) : repoConfig.path,
            filePath,
          ),
        headCommit: currentHead,
        maxFileSizeKb: repoConfig.maxFileSizeKb,
      });

      await updateAndSaveState(statePath, repoName, {
        passages: result.passages,
        lastSyncCommit: result.lastSyncCommit,
      });

      const suffix = isEventSync ? " [event]" : "";
      log(`${formatSyncLog(repoName, agentInfo.lastSyncCommit, currentHead, changedFiles.length, Date.now() - start)}${suffix}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[${repoName}] sync error: ${msg}`);
    } finally {
      syncing.delete(repoName);
      if ((pendingFilesByRepo.get(repoName)?.size ?? 0) > 0) {
        scheduleDebouncedSync(repoName, 0);
      }
    }
  }

  async function flushPending(repoName: string): Promise<void> {
    if (signal.aborted) return;
    if (syncing.has(repoName)) return;

    const pending = pendingFilesByRepo.get(repoName);
    if (!pending || pending.size === 0) return;

    pendingFilesByRepo.delete(repoName);
    await syncRepoNow(repoName, Array.from(pending));
  }

  async function tick(): Promise<void> {
    await Promise.all(
      repoNames.map(async (repoName) => {
        await syncRepoNow(repoName);
      }),
    );
  }

  for (const repoName of repoNames) {
    const repoConfig = config.repos[repoName];
    if (!repoConfig) continue;

    const ignoredFiles = new Set<string>();
    const ignoredAbsoluteFiles = new Set<string>();
    const absoluteStatePath = path.resolve(statePath);
    ignoredAbsoluteFiles.add(path.normalize(absoluteStatePath));
    const relativeStatePath = normalizeRelativePath(path.relative(repoConfig.path, absoluteStatePath));
    if (relativeStatePath && !relativeStatePath.startsWith("../") && relativeStatePath !== "..") {
      const mappedStatePath = toAgentPath(repoConfig, relativeStatePath);
      if (mappedStatePath) {
        ignoredFiles.add(mappedStatePath);
      }
    }
    ignoredEventFilesByRepo.set(repoName, ignoredFiles);
    ignoredAbsoluteEventFilesByRepo.set(repoName, ignoredAbsoluteFiles);

    try {
      const watcher = fsWatch(
        repoConfig.path,
        { recursive: true },
        (_eventType, fileName) => {
          if (signal.aborted) return;
          if (!fileName) return;
          const rawName = typeof fileName === "string" ? fileName : fileName.toString("utf-8");
          const absoluteChangedPath = path.isAbsolute(rawName)
            ? path.normalize(rawName)
            : path.normalize(path.resolve(repoConfig.path, rawName));
          if (ignoredAbsoluteEventFilesByRepo.get(repoName)?.has(absoluteChangedPath)) return;
          const mapped = toAgentPath(repoConfig, rawName);
          if (!mapped) return;
          queueFileChange(repoName, mapped);
        },
      );
      watcher.on("error", (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log(`[${repoName}] file watch error: ${msg}`);
      });
      watchers.push(watcher);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[${repoName}] file watcher unavailable; using poll only (${msg})`);
    }
  }

  // Run first tick immediately
  activeTick = tick();
  await activeTick;

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
      activeTick = trackTask(tick());
    }, intervalMs);

    signal.addEventListener("abort", async () => {
      clearInterval(timer);
      for (const debounceTimer of debounceTimers.values()) {
        clearTimeout(debounceTimer);
      }
      debounceTimers.clear();
      for (const watcher of watchers) {
        watcher.close();
      }
      await activeTick;
      await Promise.allSettled(Array.from(runningTasks));
      resolve();
    }, { once: true });
  });
}
