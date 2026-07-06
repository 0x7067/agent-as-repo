import type { EvidenceSource } from "../core/git-evidence.js";

export interface GitPort {
  /** Runs `git submodule status` in the given directory and returns raw output. */
  submoduleStatus(this: void, repoPath: string): string;
  /** Runs `git --version` and returns the trimmed output. Throws if git is not found. */
  version(this: void): string;
  /** Runs `git rev-parse HEAD` in cwd. Returns null on failure. */
  headCommit(this: void, cwd: string): string | null;
  /** Runs `git diff --name-only sinceRef..HEAD`. Returns null on failure, [] if no diff. */
  diffFiles(this: void, cwd: string, sinceRef: string): string[] | null;
  /** Runs `git cat-file -e <sha>^{commit}` to check a commit still exists. Returns false on any failure. */
  commitExists(this: void, cwd: string, sha: string): boolean;
  /** Runs `git log --name-status --oneline` scoped by the given evidence source. Returns "" on any failure. */
  logNameStatus(this: void, cwd: string, source: EvidenceSource): string;
}
