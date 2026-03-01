export interface GitPort {
  /** Runs `git submodule status` in the given directory and returns the raw output. */
  submoduleStatus(repoPath: string): string;
}
