import { createHash } from "node:crypto";

/** SHA-256 hex digest of file content. Deterministic; no I/O. */
export function hashFileContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Whether a file should be re-chunked and re-embedded given its previous and
 * current content hashes. Missing previous hash always means reindex.
 */
export function shouldReindexFile(
  previousHash: string | null | undefined,
  nextHash: string,
): boolean {
  if (previousHash === null || previousHash === undefined) return true;
  return previousHash !== nextHash;
}
