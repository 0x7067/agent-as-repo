import path from "node:path";

/**
 * Resolve a caller-supplied relative path against a repo root, rejecting
 * absolute paths and any result that escapes the root (including via `..`).
 */
export function resolveSafeRepoPath(repoRoot: string, relativePath: string): string {
  if (relativePath.trim() === "") {
    throw new Error("relative path is required (empty path rejected)");
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error(`absolute path rejected: ${relativePath}`);
  }

  const root = path.resolve(repoRoot);
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`path escapes repo root (traversal rejected): ${relativePath}`);
  }

  return resolved;
}
