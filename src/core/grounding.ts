import { extractSourcePath } from "./chunker.js";

/**
 * Pure post-processing for LLM-authored text (bootstrap memory blocks,
 * onboard walkthroughs) that names concrete files. Directory-only claims
 * ("/tests", "/middleware") are intentionally NOT validated here — they're
 * harder to ground reliably; this only checks slash-quoted, file-shaped
 * references that could be looked up in the passage index.
 */

const TEMPLATE_PATH_PREFIX = "path/to/";
const BACKTICK_TOKEN_RE = /`([^`\n]+)`/g;
/** A single path segment: word chars, dots, hyphens — no slashes. */
const PATH_SEGMENT_RE = /^[\w.-]+$/;

interface StoredPassageLike {
  text: string;
}

/** Build the set of file paths actually present in the store, derived from
 *  passages' `FILE: <path>` headers. Passages without a header (e.g. manually
 *  inserted notes) carry no path and are skipped. */
export function indexedPathsFromPassages(passages: StoredPassageLike[]): Set<string> {
  const paths = new Set<string>();
  for (const passage of passages) {
    const path = extractSourcePath(passage.text);
    if (path !== null) paths.add(path);
  }
  return paths;
}

/**
 * At least two path segments (so bare dir names like "/tests" don't match).
 * Split-then-test instead of a single `^segment(?:\/segment)+$` regex: the
 * repeated group nested inside a `+` quantifier reads as a catastrophic-
 * backtracking shape to static analysis, even though `/` disambiguates each
 * repetition here. Splitting on `/` and testing each segment matches exactly
 * the same set of strings without any regex repetition at all.
 */
function isPathLike(candidate: string): boolean {
  const segments = candidate.split("/");
  return segments.length > 1 && segments.every((segment) => PATH_SEGMENT_RE.test(segment));
}

/** Strips a literal `path/to/` template artifact so the remainder can be
 *  re-validated against the real index. */
function stripTemplatePrefix(raw: string): { candidate: string; strippedPrefix: boolean } {
  if (raw.startsWith(TEMPLATE_PATH_PREFIX)) {
    return { candidate: raw.slice(TEMPLATE_PATH_PREFIX.length), strippedPrefix: true };
  }
  return { candidate: raw, strippedPrefix: false };
}

interface LineGroundingResult {
  line: string;
  keep: boolean;
  changed: boolean;
  dropped: string[];
}

function groundLine(line: string, indexedPaths: Set<string>): LineGroundingResult {
  let changed = false;
  let keep = true;
  const dropped: string[] = [];

  const groundedLine = line.replaceAll(BACKTICK_TOKEN_RE, (match: string, raw: string) => {
    if (!isPathLike(raw)) return match;
    const { candidate, strippedPrefix } = stripTemplatePrefix(raw);
    if (!indexedPaths.has(candidate)) {
      keep = false;
      dropped.push(raw);
      return match;
    }
    if (strippedPrefix) changed = true;
    return `\`${candidate}\``;
  });

  return { line: groundedLine, keep, changed, dropped };
}

export interface GroundFileReferencesResult {
  /** Grounded text: unresolvable-path lines dropped, template prefixes stripped. */
  text: string;
  /** Whether anything was rewritten or removed. */
  changed: boolean;
  /** Raw (pre-strip) path tokens that failed validation and caused a line drop. */
  droppedPaths: string[];
}

/**
 * Validate every backtick-quoted, file-shaped path reference in `text`
 * against `indexedPaths` (paths actually present in the store):
 * - a `path/to/` template artifact is stripped and the remainder re-checked
 * - a line whose reference still doesn't resolve is dropped entirely
 * - lines with no file-shaped reference (prose, headers, bare directory
 *   mentions) pass through unchanged
 */
export function groundFileReferences(text: string, indexedPaths: Set<string>): GroundFileReferencesResult {
  const droppedPaths: string[] = [];
  let changed = false;
  const keptLines: string[] = [];

  for (const line of text.split("\n")) {
    const result = groundLine(line, indexedPaths);
    if (!result.keep) {
      changed = true;
      droppedPaths.push(...result.dropped);
      continue;
    }
    if (result.changed) changed = true;
    keptLines.push(result.line);
  }

  return { text: keptLines.join("\n"), changed, droppedPaths };
}
