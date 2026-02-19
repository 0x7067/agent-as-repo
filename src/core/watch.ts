export interface WatchConfig {
  intervalMs: number;
  debounceMs: number;
}

export const DEFAULT_WATCH_CONFIG: WatchConfig = {
  intervalMs: 5_000,
  debounceMs: 250,
};

export function shouldSync(
  lastSyncCommit: string | null,
  currentHead: string,
): boolean {
  return lastSyncCommit !== currentHead;
}

export function computeBackoffDelay(
  consecutiveFailures: number,
  baseIntervalMs: number,
  maxDelayMs = 300_000,
): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(baseIntervalMs * Math.pow(2, consecutiveFailures - 1), maxDelayMs);
}

export function formatSyncLog(
  repoName: string,
  fromCommit: string | null,
  toCommit: string,
  filesChanged: number,
  durationMs: number,
): string {
  const from = fromCommit ? fromCommit.slice(0, 7) : "initial";
  const to = toCommit.slice(0, 7);
  const secs = (durationMs / 1000).toFixed(1);
  return `[${repoName}] synced ${from}..${to} (${filesChanged} files, ${secs}s)`;
}
