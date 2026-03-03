/* eslint-disable max-lines -- watch orchestration intentionally stays in one module to preserve operational flow. */
import path from "node:path";
import { loadState, saveState } from "./state-store.js";
import { collectFiles } from "./file-collector.js";
import { syncRepo } from "./sync.js";
import { shouldSync, formatSyncLog, computeBackoffDelay } from "../core/watch.js";
import { updateAgentField } from "../core/state.js";
import { shouldIncludeFile } from "../core/filter.js";
import { partitionDiffPaths } from "../core/submodule.js";
import { listSubmodules, expandSubmoduleFiles } from "./submodule-collector.js";
import type { AgentProvider } from "./provider.js";
import type { AgentState, Config, FileInfo, RepoConfig } from "../core/types.js";
import type { FileSystemPort, WatcherHandle } from "../ports/filesystem.js";
import type { GitPort } from "../ports/git.js";
import { nodeFileSystem } from "./adapters/node-filesystem.js";
import { nodeGit } from "./adapters/node-git.js";

export interface WatchParams {
  provider: AgentProvider;
  config: Config;
  repoNames: string[];
  statePath: string;
  intervalMs: number;
  debounceMs?: number;
  signal: AbortSignal;
  log?: (msg: string) => void;
  fs?: FileSystemPort;
  git?: GitPort;
}

async function updateAndSaveState(
  statePath: string,
  repoName: string,
  updates: Partial<Omit<AgentState, "agentId" | "repoName" | "createdAt">>,
): Promise<void> {
  const freshState = await loadState(statePath);
  await saveState(statePath, updateAgentField(freshState, repoName, { ...updates, lastSyncAt: new Date().toISOString() }));
}

async function collectFile(repoPath: string, filePath: string, fs: FileSystemPort): Promise<FileInfo | null> {
  const absPath = path.join(repoPath, filePath);
  try {
    const content = await fs.readFile(absPath, "utf8");
    const stat = await fs.stat(absPath);
    return { path: filePath, content, sizeKb: stat.size / 1024 };
  } catch {
    return null;
  }
}

function normalizeRelativePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function trimTrailingSlashes(value: string): string {
  let trimmed = value;
  while (trimmed.endsWith("/")) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

function getAgentInfo(state: { agents: Record<string, AgentState> }, repoName: string): AgentState | undefined {
  if (!Object.hasOwn(state.agents, repoName)) return undefined;
  return state.agents[repoName];
}

function toAgentPath(repoConfig: RepoConfig, repoRelativePath: string): string | null {
  const normalized = normalizeRelativePath(repoRelativePath);
  if (!normalized) return null;
  if (!repoConfig.basePath) return normalized;

  const normalizedBase = trimTrailingSlashes(normalizeRelativePath(repoConfig.basePath));
  if (normalized === normalizedBase) return null;
  if (!normalized.startsWith(`${normalizedBase}/`)) return null;
  return normalized.slice(normalizedBase.length + 1);
}

async function filterChangedFiles(repoConfig: RepoConfig, changedFiles: string[]): Promise<string[]> {
  const regularFiles = changedFiles
    .map((filePath) => toAgentPath(repoConfig, filePath))
    .filter((filePath): filePath is string => filePath !== null && shouldIncludeFile(filePath, 0, repoConfig));

  if (!repoConfig.includeSubmodules) return regularFiles;

  const submodules = listSubmodules(repoConfig.path);
  const { changedSubmodules } = partitionDiffPaths(changedFiles, submodules, () => true);

  const expanded: string[] = [];
  for (const sub of changedSubmodules) {
    const paths = await expandSubmoduleFiles(repoConfig, sub);
    expanded.push(...paths);
  }

  return [...regularFiles, ...expanded];
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
    fs = nodeFileSystem,
    git = nodeGit,
  } = params;
  const syncing = new Set<string>();
  const pendingFilesByRepo = new Map<string, Set<string>>();
  const debounceTimers = new Map<string, NodeJS.Timeout>();
  const watchers: WatcherHandle[] = [];
  const runningTasks = new Set<Promise<void>>();
  const ignoredEventFilesByRepo = new Map<string, Set<string>>();
  const ignoredAbsoluteEventFilesByRepo = new Map<string, Set<string>>();
  const consecutiveFailures = new Map<string, number>();
  const backoffUntil = new Map<string, number>();
  let stateWriteChain: Promise<void> = Promise.resolve();
  let activeTick: Promise<void> = Promise.resolve();

  function trackTask(task: Promise<void>): Promise<void> {
    runningTasks.add(task);
    void task.finally(() => {
      runningTasks.delete(task);
    });
    return task;
  }

  function getRepoConfig(repoName: string): RepoConfig | undefined {
    if (!Object.hasOwn(config.repos, repoName)) return undefined;
    return config.repos[repoName];
  }

  async function persistHeadCommitOnly(repoName: string, currentHead: string): Promise<void> {
    stateWriteChain = stateWriteChain.then(() =>
      updateAndSaveState(statePath, repoName, { lastSyncCommit: currentHead }),
    ).catch(() => {});
    await stateWriteChain;
  }

  async function persistSyncResult(repoName: string, passages: AgentState["passages"], lastSyncCommit: string): Promise<void> {
    stateWriteChain = stateWriteChain.then(() =>
      updateAndSaveState(statePath, repoName, {
        passages,
        lastSyncCommit,
      }),
    ).catch(() => {});
    await stateWriteChain;
  }

  async function resolveChangedFiles(params_: {
    repoConfig: RepoConfig;
    agentInfo: AgentState;
    isEventSync: boolean;
    eventChangedFiles?: string[];
    repoName: string;
  }): Promise<string[] | undefined> {
    const {
      repoConfig,
      agentInfo,
      isEventSync,
      eventChangedFiles,
      repoName,
    } = params_;

    if (isEventSync) {
      return (eventChangedFiles ?? []).filter((filePath) => shouldIncludeFile(filePath, 0, repoConfig));
    }

    if (agentInfo.lastSyncCommit) {
      const diffResult = git.diffFiles(repoConfig.path, agentInfo.lastSyncCommit);
      if (diffResult === null) {
        log(`[${repoName}] git diff failed, skipping`);
        return undefined;
      }
      return filterChangedFiles(repoConfig, diffResult);
    }

    const files = await collectFiles(repoConfig);
    return files.map((file) => file.path);
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
    const repoConfig = getRepoConfig(repoName);
    if (repoConfig === undefined) return;
    if (ignoredEventFilesByRepo.get(repoName)?.has(filePath)) return;
    if (!shouldIncludeFile(filePath, 0, repoConfig)) return;

    const pending = pendingFilesByRepo.get(repoName) ?? new Set<string>();
    pending.add(filePath);
    pendingFilesByRepo.set(repoName, pending);
    scheduleDebouncedSync(repoName);
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity -- central sync control flow intentionally handles backoff, event, and polling branches together
  async function syncRepoNow(repoName: string, eventChangedFiles?: string[]): Promise<void> {
    if (signal.aborted) return;
    if (syncing.has(repoName)) return;

    // Backoff: skip this tick if we're still in the cooldown window
    const until = backoffUntil.get(repoName) ?? 0;
    if (Date.now() < until) return;

    const state = await loadState(statePath);
    const agentInfo = getAgentInfo(state, repoName);
    if (agentInfo === undefined) return;

    const repoConfig = getRepoConfig(repoName);
    if (repoConfig === undefined) return;

    const currentHead = git.headCommit(repoConfig.path);
    if (typeof currentHead !== "string" || currentHead.length === 0) return;

    const isEventSync = eventChangedFiles !== undefined && eventChangedFiles.length > 0;
    if (!isEventSync && !shouldSync(agentInfo.lastSyncCommit, currentHead)) {
      log(`[${repoName}] no changes (HEAD=${currentHead.slice(0, 7)})`);
      return;
    }

    syncing.add(repoName);
    try {
      const start = Date.now();
      const changedFilesParams = {
        repoConfig,
        agentInfo,
        isEventSync,
        repoName,
        ...(eventChangedFiles === undefined ? {} : { eventChangedFiles }),
      };
      const changedFilesResult = await resolveChangedFiles(changedFilesParams);
      if (changedFilesResult === undefined) return;

      const changedFiles = [...new Set(changedFilesResult)];
      if (changedFiles.length === 0) {
        if (isEventSync) {
          return;
        }

        // HEAD changed but no indexable file diff (e.g., merge commit) — update state
        await persistHeadCommitOnly(repoName, currentHead);
        log(formatSyncLog(repoName, agentInfo.lastSyncCommit, currentHead, 0, Date.now() - start));
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
            fs,
          ),
        headCommit: currentHead,
        maxFileSizeKb: repoConfig.maxFileSizeKb,
      });

      await persistSyncResult(repoName, result.passages, result.lastSyncCommit);

      const suffix = isEventSync ? " [event]" : "";
      const elapsedMs = Date.now() - start;
      log(`${formatSyncLog(repoName, agentInfo.lastSyncCommit, currentHead, changedFiles.length, elapsedMs)}${suffix}`);

      // Reset backoff on success
      consecutiveFailures.set(repoName, 0);
      backoffUntil.delete(repoName);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const failures = (consecutiveFailures.get(repoName) ?? 0) + 1;
      consecutiveFailures.set(repoName, failures);
      const delay = computeBackoffDelay(failures, intervalMs);
      backoffUntil.set(repoName, Date.now() + delay);
      const backoffSeconds = Math.round(delay / 1000);
      log(`[${repoName}] sync error (attempt ${String(failures)}, backoff ${String(backoffSeconds)}s): ${msg}`);
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
    await syncRepoNow(repoName, [...pending]);
  }

  async function tick(): Promise<void> {
    await Promise.all(
      repoNames.map(async (repoName) => {
        await syncRepoNow(repoName);
      }),
    );
  }

  for (const repoName of repoNames) {
    const repoConfig = getRepoConfig(repoName);
    if (repoConfig === undefined) continue;

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
      const watcher = fs.watch(
        repoConfig.path,
        { recursive: true },
        (_eventType, fileName) => {
          if (signal.aborted) return;
          if (!fileName) return;
          const rawName = fileName;
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
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
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

    const shutdown = async (): Promise<void> => {
      clearInterval(timer);
      for (const debounceTimer of debounceTimers.values()) {
        clearTimeout(debounceTimer);
      }
      debounceTimers.clear();
      for (const watcher of watchers) {
        watcher.close();
      }
      await activeTick;
      await Promise.allSettled(runningTasks);
      resolve();
    };

    signal.addEventListener("abort", () => {
      void shutdown();
    }, { once: true });
  });
}
/* eslint-enable max-lines */
