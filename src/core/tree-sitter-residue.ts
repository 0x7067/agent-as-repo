import { chunkFile } from "./chunker.js";
import type { Chunk } from "./types.js";

/** A byte/char range within a file's content, using the same `[startIndex, endIndex)` convention
 * as `SymbolSpan` (see tree-sitter-symbols.ts) — deliberately structural rather than importing
 * that type, so this module stays a leaf with no dependency on the symbol-extraction layer. */
export interface IndexRange {
  startIndex: number;
  endIndex: number;
}

const ALPHANUMERIC = /[a-z0-9]/i;

/** Merge a set of (possibly overlapping/nested/unsorted) ranges into a sorted, non-overlapping
 * list. Nested ranges (e.g. a CLASS span containing its METHOD spans) collapse into their
 * enclosing range. */
export function mergeRanges(ranges: readonly IndexRange[]): IndexRange[] {
  const sorted = [...ranges];
  sorted.sort((a, b) => a.startIndex - b.startIndex);
  const merged: IndexRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.startIndex <= last.endIndex) {
      last.endIndex = Math.max(last.endIndex, range.endIndex);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** Given merged, sorted `covered` ranges, return the gaps in `[0, totalLength)` they don't span. */
export function findGaps(totalLength: number, covered: readonly IndexRange[]): IndexRange[] {
  const gaps: IndexRange[] = [];
  let cursor = 0;
  for (const range of covered) {
    if (range.startIndex > cursor) {
      gaps.push({ startIndex: cursor, endIndex: range.startIndex });
    }
    cursor = Math.max(cursor, range.endIndex);
  }
  if (cursor < totalLength) {
    gaps.push({ startIndex: cursor, endIndex: totalLength });
  }
  return gaps;
}

/** Skip fragments with no alphanumeric character at all — e.g. a lone `}` or blank lines left
 * between two adjacent spans aren't worth their own chunk. */
export function hasAlphanumeric(text: string): boolean {
  return ALPHANUMERIC.test(text);
}

/**
 * Compute "residue" chunks: the parts of `content` not covered by any of `ranges`, chunked with
 * the plain `FILE: <path>` header (same as the raw-fallback path). This closes the systemic gap
 * where span-based chunking silently drops any source text a language's symbol extractor doesn't
 * happen to wrap in a span (e.g. top-level statements, `use`/`const` items, preprocessor-guarded
 * declarations) as soon as at least one span exists for the file.
 *
 * Invariant this restores: every alphanumeric-containing byte of `content` appears in at least
 * one chunk (either a named span chunk or a residue chunk).
 */
export function residueChunks(
  filePath: string,
  content: string,
  ranges: readonly IndexRange[],
  maxChars: number,
): Chunk[] {
  const covered = mergeRanges(ranges);
  const gaps = findGaps(content.length, covered);
  const chunks: Chunk[] = [];
  for (const gap of gaps) {
    const text = content.slice(gap.startIndex, gap.endIndex);
    if (!hasAlphanumeric(text)) continue;
    chunks.push(...chunkFile(filePath, text, maxChars));
  }
  return chunks;
}
