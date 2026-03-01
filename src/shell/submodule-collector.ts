import * as path from "node:path";
import { parseSubmoduleStatus } from "../core/submodule.js";
import { collectFiles } from "./file-collector.js";
import { nodeGit } from "./adapters/node-git.js";
import type { GitPort } from "../ports/git.js";
import type { RepoConfig, SubmoduleInfo } from "../core/types.js";

/**
 * Collects all files from an initialized submodule and returns their repo-root-relative paths.
 * Returns an empty array if the submodule is not initialized.
 */
export async function expandSubmoduleFiles(
  repoConfig: RepoConfig,
  submodule: SubmoduleInfo,
): Promise<string[]> {
  if (!submodule.initialized) return [];

  const files = await collectFiles({
    ...repoConfig,
    path: path.join(repoConfig.path, submodule.path),
    basePath: undefined,
    includeSubmodules: false, // don't recurse into nested submodules
  });

  return files.map((f) => `${submodule.path}/${f.path}`);
}

/**
 * Returns all submodules for the repo at `repoPath` by running `git submodule status`.
 * Returns an empty array if the repo has no submodules or if git is unavailable.
 */
export function listSubmodules(
  repoPath: string,
  git: GitPort = nodeGit,
): SubmoduleInfo[] {
  const output = git.submoduleStatus(repoPath);
  return parseSubmoduleStatus(output);
}
