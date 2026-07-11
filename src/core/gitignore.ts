/**
 * Minimal, pure `.gitignore` pattern matcher — enough to answer "would this
 * relative path be ignored by this .gitignore content?" for the plaintext-key
 * warning on `mcp-install --local` (finding 8). Not a full gitignore
 * implementation (no `**`, no nested-directory anchoring beyond a single
 * leading `/`), but covers the common cases: exact names, `*`/`?` globs,
 * comments, blank lines, negation (`!pattern`), and directory-only patterns
 * (trailing `/`).
 */

const REGEX_SPECIAL_CHARS = new Set([".", "+", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]);

function patternToRegExp(pattern: string): RegExp {
  let source = "";
  for (const char of pattern) {
    if (char === "*") {
      source += ".*";
    } else if (char === "?") {
      source += ".";
    } else if (REGEX_SPECIAL_CHARS.has(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  // `source` is a translated .gitignore glob pattern (trusted local file
  // content the caller read from disk, not attacker-controlled input),
  // never raw regex syntax.
  // eslint-disable-next-line security/detect-non-literal-regexp
  return new RegExp(`^${source}$`);
}

interface ParsedGitignoreLine {
  negate: boolean;
  /** Anchored to the gitignore's own directory (leading "/"). */
  anchored: boolean;
  /** Directory-only pattern (trailing "/") — can't match a plain file. */
  dirOnly: boolean;
  corePattern: string;
}

function parseGitignoreLine(rawLine: string): ParsedGitignoreLine | null {
  const line = rawLine.trim();
  if (line === "" || line.startsWith("#")) return null;

  const negate = line.startsWith("!");
  const patternRaw = negate ? line.slice(1) : line;
  const dirOnly = patternRaw.endsWith("/");
  const pattern = dirOnly ? patternRaw.slice(0, -1) : patternRaw;
  if (pattern === "") return null;

  const anchored = pattern.startsWith("/");
  const corePattern = anchored ? pattern.slice(1) : pattern;
  if (corePattern === "") return null;

  return { negate, anchored, dirOnly, corePattern };
}

function lineMatches(
  parsed: ParsedGitignoreLine,
  normalizedPath: string,
  segments: string[],
  basename: string,
): boolean {
  // A directory-only pattern can never match a plain file with no
  // directory component of its own.
  if (parsed.dirOnly && segments.length === 1) return false;

  const regex = patternToRegExp(parsed.corePattern);
  if (parsed.anchored || parsed.corePattern.includes("/")) {
    return regex.test(normalizedPath);
  }
  return regex.test(basename) || segments.some((segment) => regex.test(segment));
}

/**
 * Does `.gitignore` content cover `relativePath` (a path relative to the
 * directory containing the .gitignore)? Later lines override earlier ones,
 * matching git's own "last matching pattern wins" semantics.
 */
export function isPathIgnoredByGitignore(gitignoreContent: string, relativePath: string): boolean {
  const normalizedPath = relativePath.replace(/^\.\//, "");
  const segments = normalizedPath.split("/");
  const basename = segments.at(-1) ?? normalizedPath;

  let ignored = false;
  for (const rawLine of gitignoreContent.split(/\r?\n/)) {
    const parsed = parseGitignoreLine(rawLine);
    if (parsed === null) continue;
    if (lineMatches(parsed, normalizedPath, segments, basename)) {
      ignored = !parsed.negate;
    }
  }

  return ignored;
}
