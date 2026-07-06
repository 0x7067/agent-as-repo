import { createHash } from "node:crypto";

/**
 * Deterministic SHA-256 fingerprint of a set of labeled block values.
 *
 * Labels are sorted with `localeCompare` before hashing so key order in the
 * input never affects the result. Each contribution is null-byte delimited
 * (`label\0value\0`) so `("a", "bc")` cannot collide with `("ab", "c")`.
 * `node:crypto` is deterministic and does no I/O, so this stays core-eligible.
 */
export function fingerprintBlocks(blocks: Record<string, string>): string {
  const hash = createHash("sha256");
  const entries = Object.entries(blocks);
  entries.sort(([a], [b]) => a.localeCompare(b));
  for (const [label, value] of entries) {
    hash.update(label);
    hash.update("\0");
    hash.update(value);
    hash.update("\0");
  }
  return hash.digest("hex");
}
