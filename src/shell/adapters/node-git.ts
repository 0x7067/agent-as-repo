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
};
