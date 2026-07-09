import type { RepoConfig } from "../core/types.js";
import type { FileSystemPort } from "./filesystem.js";

/** Result of running ripgrep (or a test double) against a repo. */
export interface GrepRunnerResult {
  stdout: string;
  /** Non-zero when rg found no matches (exit 1) or failed. */
  exitCode: number;
  /** Set when the binary is missing or the process could not start. */
  error?: string;
}

/**
 * Live-repo access for agentic search tools. Implementations resolve an
 * agent's RepoConfig (agentId === repoName) and run filesystem / ripgrep I/O.
 */
export interface RepoAccessPort {
  resolve(this: void, agentId: string): RepoConfig | undefined;
  fs: FileSystemPort;
  /**
   * Run ripgrep with a pre-built argv (from `buildRipgrepArgs`) and cwd.
   * Must use execFile-style invocation — never a shell string.
   */
  grep(this: void, args: string[], cwd: string): GrepRunnerResult;
}
