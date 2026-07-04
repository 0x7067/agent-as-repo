import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface RepoExpertPathOptions {
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

function ensureWritableDirectory(directory: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is constrained to app-controlled candidate directories
  mkdirSync(directory, { recursive: true });
  const probePath = path.join(directory, `.probe-${String(process.pid)}-${String(Date.now())}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- probe path is under the vetted directory above
  writeFileSync(probePath, "ok", "utf8");
  rmSync(probePath, { force: true });
}

/**
 * Resolve the writable directory that holds all repo-expert machine-local
 * data (the sqlite store with passages, vectors, and memory blocks).
 * Candidates: REPO_EXPERT_DATA_DIR → ~/.repo-expert → ./.repo-expert.
 */
export function resolveRepoExpertDataDir(options: RepoExpertPathOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? homedir();
  const env = options.env ?? process.env;

  const envValue = env["REPO_EXPERT_DATA_DIR"]?.trim();
  const candidates: string[] = [
    ...(envValue ? [path.isAbsolute(envValue) ? envValue : path.resolve(cwd, envValue)] : []),
    path.join(homeDir, ".repo-expert"),
    path.join(cwd, ".repo-expert"),
  ];

  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      ensureWritableDirectory(candidate);
      return candidate;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${candidate}: ${message}`);
    }
  }

  throw new Error(
    [
      "Unable to find a writable repo-expert data directory.",
      "Set REPO_EXPERT_DATA_DIR to a writable location.",
      ...errors.map((e) => `- ${e}`),
    ].join("\n"),
  );
}

/** Location of the embedded passage/block store DB file. */
export function resolveStoreDbPath(options: RepoExpertPathOptions = {}): string {
  return path.join(resolveRepoExpertDataDir(options), "store.db");
}
