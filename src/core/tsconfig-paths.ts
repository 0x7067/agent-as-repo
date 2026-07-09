/**
 * Pure tsconfig-style path alias resolution for the symbol graph.
 * No filesystem I/O — callers supply a parsed PathAliasConfig.
 */

export interface PathAliasConfig {
  /** Repo-relative posix directory used as baseUrl (e.g. `"src"` or `"."`). */
  baseUrl: string;
  /** Patterns like `@app/*` mapped to targets like `["src/app/*"]`. */
  paths: ReadonlyArray<{ pattern: string; targets: readonly string[] }>;
}

/**
 * Parse a minimal subset of tsconfig/jsconfig JSON into PathAliasConfig.
 * Accepts already-parsed objects (tests) or JSON text.
 */
export function parsePathAliasConfig(raw: unknown): PathAliasConfig | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const compilerOptions = record["compilerOptions"];
  if (typeof compilerOptions !== "object" || compilerOptions === null) return undefined;
  const opts = compilerOptions as Record<string, unknown>;

  const baseUrl = typeof opts["baseUrl"] === "string" ? opts["baseUrl"].replaceAll("\\", "/") : ".";
  const pathsRaw = opts["paths"];
  if (typeof pathsRaw !== "object" || pathsRaw === null) {
    return { baseUrl, paths: [] };
  }

  const paths: Array<{ pattern: string; targets: string[] }> = [];
  for (const [pattern, targets] of Object.entries(pathsRaw as Record<string, unknown>)) {
    if (!Array.isArray(targets)) continue;
    const stringTargets = targets.filter((t): t is string => typeof t === "string");
    if (stringTargets.length === 0) continue;
    paths.push({ pattern, targets: stringTargets });
  }
  return { baseUrl, paths };
}

function expandOnePattern(
  specifier: string,
  pattern: string,
  targets: readonly string[],
  baseUrl: string,
): string[] {
  const star = pattern.indexOf("*");
  if (star === -1) {
    if (specifier !== pattern) return [];
    return targets.map((target) => joinBase(baseUrl, target.replaceAll("*", "")));
  }
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return [];
  const matched = specifier.slice(prefix.length, specifier.length - suffix.length);
  return targets.map((target) => {
    const expanded = target.includes("*") ? target.replace("*", matched) : target;
    return joinBase(baseUrl, expanded);
  });
}

/**
 * Resolve a bare/aliased module specifier via tsconfig paths.
 * Returns candidate repo-relative paths (without forcing an extension).
 */
export function expandPathAlias(
  specifier: string,
  aliases: PathAliasConfig,
): string[] {
  const results: string[] = [];
  for (const { pattern, targets } of aliases.paths) {
    results.push(...expandOnePattern(specifier, pattern, targets, aliases.baseUrl));
  }
  return results;
}

function joinBase(baseUrl: string, rel: string): string {
  const cleaned = rel.replaceAll("\\", "/");
  if (cleaned.startsWith("./") || cleaned.startsWith("../") || cleaned.startsWith("/")) {
    return normalizePosix(cleaned);
  }
  const base = baseUrl.replaceAll("\\", "/").replace(/\/$/, "") || ".";
  if (base === "." || base === "") return normalizePosix(cleaned);
  return normalizePosix(`${base}/${cleaned}`);
}

function normalizePosix(p: string): string {
  const parts = p.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}
