import type { SubmoduleInfo } from "./types.js";

/**
 * Parses the output of `git submodule status` into structured SubmoduleInfo records.
 *
 * Each line format: `[status]<hash> <path> [(<description>)]`
 *   - status: ' ' (synced), '+' (different commit), '-' (not initialized), 'U' (conflict)
 */
export function parseSubmoduleStatus(output: string): SubmoduleInfo[] {
  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const statusChar = line[0];
      const rest = line.slice(1).trim(); // "<hash> <path> [(desc)]"
      const parts = rest.split(/\s+/);
      const commit = parts[0];
      const subPath = parts[1];
      if (!commit || !subPath) return null;
      return {
        path: subPath,
        commit,
        initialized: statusChar !== "-",
      };
    })
    .filter((info): info is SubmoduleInfo => info !== null);
}

/**
 * Returns the SubmoduleInfo for `filePath` if it matches a known submodule path,
 * otherwise returns undefined.
 */
export function isSubmoduleChange(
  filePath: string,
  submodules: SubmoduleInfo[],
): SubmoduleInfo | undefined {
  return submodules.find((sub) => sub.path === filePath);
}

/**
 * Splits a list of git-diff paths into submodule pointer changes and regular file changes.
 * Regular files are filtered through `filterFn` (e.g., shouldIncludeFile).
 * Submodule paths are deduplicated.
 */
export function partitionDiffPaths(
  diffPaths: string[],
  submodules: SubmoduleInfo[],
  filterFn: (path: string) => boolean,
): { changedSubmodules: SubmoduleInfo[]; regularFiles: string[] } {
  const seenSubmodules = new Set<string>();
  const changedSubmodules: SubmoduleInfo[] = [];
  const regularFiles: string[] = [];

  for (const p of diffPaths) {
    const sub = isSubmoduleChange(p, submodules);
    if (sub) {
      if (!seenSubmodules.has(sub.path)) {
        seenSubmodules.add(sub.path);
        changedSubmodules.push(sub);
      }
    } else if (filterFn(p)) {
      regularFiles.push(p);
    }
  }

  return { changedSubmodules, regularFiles };
}
