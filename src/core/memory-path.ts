import path from "node:path";

/**
 * Reject agentId/label segments that could escape a memory root via path.join.
 * Allows letters, digits, `.`, `_`, `-` only (no separators or `..`).
 */
export function assertSafeMemorySegment(segment: string, kind: "agentId" | "label"): string {
  const trimmed = segment.trim();
  if (trimmed.length === 0) {
    throw new Error(`${kind} is required (empty value rejected)`);
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error(`${kind} rejects "." / "..": ${segment}`);
  }
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
    throw new Error(`${kind} must not contain path separators: ${segment}`);
  }
  if (!/^[\w.-]+$/u.test(trimmed)) {
    throw new Error(`${kind} contains invalid characters: ${segment}`);
  }
  return trimmed;
}

/**
 * Resolve `memoryDir/agentId` or `memoryDir/agentId/label.md`, rejecting escapes.
 */
export function resolveSafeMemoryPath(
  memoryDir: string,
  agentId: string,
  fileName?: string,
): string {
  const root = path.resolve(memoryDir);
  const safeAgent = assertSafeMemorySegment(agentId, "agentId");
  const parts = [safeAgent];
  if (fileName !== undefined) {
    const label = fileName.endsWith(".md") ? fileName.slice(0, -3) : fileName;
    const safeLabel = assertSafeMemorySegment(label, "label");
    parts.push(`${safeLabel}.md`);
  }
  const resolved = path.resolve(root, ...parts);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    const detail = fileName === undefined ? agentId : `${agentId}/${fileName}`;
    throw new Error(`path escapes memory root (traversal rejected): ${detail}`);
  }
  return resolved;
}
