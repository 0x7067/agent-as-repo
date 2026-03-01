export interface GitPort {
  /** Runs `git submodule status` in the given directory and returns raw output. */
  submoduleStatus(repoPath: string): string;
  /** Runs `git --version` and returns the trimmed output. Throws if git is not found. */
  version(): string;
  /** Runs `git rev-parse HEAD` in cwd. Returns null on failure. */
  headCommit(cwd: string): string | null;
  /** Runs `git diff --name-only sinceRef..HEAD`. Returns null on failure, [] if no diff. */
  diffFiles(cwd: string, sinceRef: string): string[] | null;
}
