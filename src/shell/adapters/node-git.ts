import { execFileSync } from "node:child_process";
import type { GitPort } from "../../ports/git.js";

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
      timeout: 5_000,
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
};
