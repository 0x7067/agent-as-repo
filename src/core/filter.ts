import { MAX_INDEXABLE_FILE_SIZE_KB, type RepoConfig } from "./types.js";

export interface FilterOptions {
  extensions: string[];
  ignoreDirs: string[];
  maxFileSizeKb: number;
}

/** Filter options for a repo: its extensions/ignore dirs + the built-in size cap. */
export function repoFilterOptions(repo: Pick<RepoConfig, "extensions" | "ignoreDirs">): FilterOptions {
  return {
    extensions: repo.extensions,
    ignoreDirs: repo.ignoreDirs,
    maxFileSizeKb: MAX_INDEXABLE_FILE_SIZE_KB,
  };
}

export function shouldIncludeFile(
  filePath: string,
  fileSizeKb: number,
  options: FilterOptions,
): boolean {
  const dotIdx = filePath.lastIndexOf(".");
  const ext = dotIdx === -1 ? "" : filePath.slice(dotIdx);
  if (!options.extensions.includes(ext)) return false;

  if (fileSizeKb > options.maxFileSizeKb) return false;

  const segments = filePath.split("/");
  for (const segment of segments) {
    if (options.ignoreDirs.includes(segment)) return false;
  }

  return true;
}
