import { execFileSync } from "node:child_process";
import type { GitPort } from "../../ports/git.js";
import type { EvidenceSource } from "../../core/git-evidence.js";

/** Max buffer size for git log output — bounds a pathological history from blowing memory. */
const LOG_MAX_BUFFER_BYTES = 1024 * 1024;

export const nodeGit: GitPort = {
  submoduleStatus(repoPath: string): string {
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
      return execFileSync("git", ["submodule", "status"], {
        cwd: repoPath,
        encoding: "utf8",
        timeout: 10_000,
      });
    } catch {
      return "";
    }
  },

  version(): string {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
    return execFileSync("git", ["--version"], {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
  },

  headCommit(cwd: string): string | null {
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
      return execFileSync("git", ["rev-parse", "HEAD"], {
        cwd,
        encoding: "utf8",
        timeout: 10_000,
      }).trim();
    } catch {
      return null;
    }
  },

  diffFiles(cwd: string, sinceRef: string): string[] | null {
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
      const output = execFileSync("git", ["diff", "--name-only", `${sinceRef}..HEAD`], {
        cwd,
        encoding: "utf8",
        timeout: 10_000,
      }).trim();
      return output ? output.split("\n") : [];
    } catch {
      return null;
    }
  },

  commitExists(cwd: string, sha: string): boolean {
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
      execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
        cwd,
        encoding: "utf8",
        timeout: 10_000,
      });
      return true;
    } catch {
      return false;
    }
  },

  logNameStatus(cwd: string, source: EvidenceSource): string {
    const args = ["--no-pager", "log", "--name-status", "--oneline"];
    switch (source.kind) {
      case "range": {
        args.push(`${source.from}..HEAD`);
        break;
      }
      case "since": {
        args.push(`--since=${source.date}`);
        break;
      }
      case "recent": {
        args.push(`--max-count=${String(source.count)}`);
        break;
      }
    }

    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- git must be resolved from PATH
      return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: LOG_MAX_BUFFER_BYTES,
      });
    } catch {
      return "";
    }
  },
};
