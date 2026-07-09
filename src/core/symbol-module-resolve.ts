import path from "node:path";
import { expandPathAlias, type PathAliasConfig } from "./tsconfig-paths.js";

const RELATIVE_SPEC_RE = /^\.{1,2}\//;

const MODULE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
] as const;

function candidatesForJoined(joined: string): string[] {
  return [
    joined,
    ...MODULE_EXTENSIONS.map((ext) => `${joined}${ext}`),
    ...(["index.ts", "index.tsx", "index.js", "__init__.py"] as const).map((name) =>
      path.posix.join(joined, name),
    ),
  ];
}

function firstKnown(candidates: readonly string[], knownFiles: ReadonlySet<string>): string | undefined {
  return candidates.find((candidate) => knownFiles.has(candidate));
}

/**
 * Resolve a relative ESM module specifier against the importing file's directory.
 * Tries common extensions and `/index` variants.
 */
export function resolveRelativeModule(
  fromFilePath: string,
  moduleSpecifier: string,
  knownFiles: ReadonlySet<string>,
): string | undefined {
  if (!RELATIVE_SPEC_RE.test(moduleSpecifier)) return undefined;

  const dir = path.posix.dirname(fromFilePath.replaceAll("\\", "/"));
  const joined = path.posix.normalize(path.posix.join(dir, moduleSpecifier));
  return firstKnown(candidatesForJoined(joined), knownFiles);
}

/**
 * Resolve a Python relative import (`.foo`, `..bar`) against the importer path.
 * Leading dots: one = current package dir; each extra dot goes up one level.
 */
export function resolvePythonRelativeModule(
  fromFilePath: string,
  moduleSpecifier: string,
  knownFiles: ReadonlySet<string>,
): string | undefined {
  // Skip ESM-style `./` / `../` (handled by resolveRelativeModule)
  if (moduleSpecifier.startsWith("./") || moduleSpecifier.startsWith("../")) return undefined;
  if (!moduleSpecifier.startsWith(".")) return undefined;

  let dotCount = 0;
  while (dotCount < moduleSpecifier.length && moduleSpecifier[dotCount] === ".") {
    dotCount++;
  }
  const remainder = moduleSpecifier.slice(dotCount).replaceAll(".", "/");
  let packageDir = path.posix.dirname(fromFilePath.replaceAll("\\", "/"));
  for (let i = 1; i < dotCount; i++) {
    packageDir = path.posix.dirname(packageDir);
  }
  const joined = remainder.length > 0
    ? path.posix.normalize(path.posix.join(packageDir, remainder))
    : packageDir;
  return firstKnown(candidatesForJoined(joined), knownFiles);
}

/**
 * Resolve a module specifier: relative ESM, Python relative, then tsconfig aliases.
 */
export function resolveModuleSpecifier(
  fromFilePath: string,
  moduleSpecifier: string,
  knownFiles: ReadonlySet<string>,
  pathAliases?: PathAliasConfig,
): string | undefined {
  const relative = resolveRelativeModule(fromFilePath, moduleSpecifier, knownFiles);
  if (relative !== undefined) return relative;

  const pyRelative = resolvePythonRelativeModule(fromFilePath, moduleSpecifier, knownFiles);
  if (pyRelative !== undefined) return pyRelative;

  if (pathAliases === undefined) return undefined;
  for (const expanded of expandPathAlias(moduleSpecifier, pathAliases)) {
    const hit = firstKnown(candidatesForJoined(expanded), knownFiles);
    if (hit !== undefined) return hit;
  }
  return undefined;
}
