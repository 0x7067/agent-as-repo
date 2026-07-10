import path from "node:path";

function normalizeRelativePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

/** Map a git repo-relative path into an optional configured subtree. */
export function toAgentPath(repoRelativePath: string, basePath?: string): string | null {
  const normalized = normalizeRelativePath(repoRelativePath);
  if (!normalized) return null;
  if (basePath === undefined || basePath.trim() === "") return normalized;

  const normalizedBase = normalizeRelativePath(basePath);
  if (normalized === normalizedBase) return null;
  if (!normalized.startsWith(`${normalizedBase}/`)) return null;
  return normalized.slice(normalizedBase.length + 1);
}

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
