import { readFileSync } from "node:fs";
import path from "node:path";
import { prepareJsonc } from "../core/jsonc.js";
import { parsePathAliasConfig, type PathAliasConfig } from "../core/tsconfig-paths.js";

export interface LoadPathAliasesOptions {
  /** Optional logger for non-ENOENT failures (default: silent). */
  onWarn?: (message: string) => void;
  /** Optional repo-relative subdirectory used as the agent's indexed root. */
  basePath?: string;
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "ENOENT";
}

function normalizePosix(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  return normalized === "." ? "" : normalized.replace(/^\.\//, "");
}

function isInsideBasePath(candidate: string, basePath: string): boolean {
  return candidate === basePath || candidate.startsWith(`${basePath}/`);
}

function stripBasePath(candidate: string, basePath: string): string {
  if (candidate === basePath) return ".";
  return candidate.slice(basePath.length + 1);
}

function joinBase(baseUrl: string, target: string): string {
  const cleanTarget = target.replaceAll("\\", "/");
  if (cleanTarget.startsWith("./") || cleanTarget.startsWith("../") || cleanTarget.startsWith("/")) {
    return normalizePosix(cleanTarget);
  }
  const cleanBase = normalizePosix(baseUrl);
  return normalizePosix(cleanBase.length === 0 ? cleanTarget : `${cleanBase}/${cleanTarget}`);
}

function rebaseAliasesToBasePath(
  cfg: PathAliasConfig,
  basePath: string | undefined,
): PathAliasConfig | undefined {
  const normalizedBase = basePath === undefined ? "" : normalizePosix(basePath);
  if (normalizedBase.length === 0) return cfg;

  const paths: Array<{ pattern: string; targets: string[] }> = [];
  for (const { pattern, targets } of cfg.paths) {
    const rebasedTargets = targets.flatMap((target) => {
      const rootRelative = joinBase(cfg.baseUrl, target);
      if (!isInsideBasePath(rootRelative, normalizedBase)) return [];
      return [stripBasePath(rootRelative, normalizedBase)];
    });
    if (rebasedTargets.length > 0) {
      paths.push({ pattern, targets: rebasedTargets });
    }
  }

  if (paths.length === 0) return undefined;
  return { baseUrl: ".", paths };
}

function parseConfigFile(
  filePath: string,
  basePath: string | undefined,
  onWarn: ((message: string) => void) | undefined,
): PathAliasConfig | undefined {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath is derived from configured repoRoot/basePath
    const text = readFileSync(filePath, "utf8");
    const raw: unknown = JSON.parse(prepareJsonc(text));
    const cfg = parsePathAliasConfig(raw);
    if (cfg === undefined) {
      onWarn?.(`${filePath}: no usable compilerOptions.paths/baseUrl`);
      return undefined;
    }
    const rebased = rebaseAliasesToBasePath(cfg, basePath);
    if (rebased !== undefined) return rebased;
    onWarn?.(`${filePath}: compilerOptions.paths do not target basePath ${basePath ?? ""}`);
  } catch (error) {
    if (isEnoent(error)) return undefined;
    onWarn?.(
      `${filePath}: ${error instanceof Error ? error.message : "failed to load path aliases"}`,
    );
  }
  return undefined;
}

/**
 * Load path aliases from tsconfig.json / jsconfig.json under repoRoot.
 * Shell-only (fs). Returns undefined when missing or unparsable.
 */
export function loadPathAliasesFromRepo(
  repoRoot: string,
  options: LoadPathAliasesOptions = {},
): PathAliasConfig | undefined {
  const { basePath, onWarn } = options;
  const configNames = ["tsconfig.json", "jsconfig.json"] as const;

  if (basePath !== undefined && normalizePosix(basePath).length > 0) {
    const baseRoot = path.join(repoRoot, basePath);
    for (const name of configNames) {
      const cfg = parseConfigFile(path.join(baseRoot, name), undefined, onWarn);
      if (cfg !== undefined) return cfg;
    }
  }

  for (const name of configNames) {
    const cfg = parseConfigFile(path.join(repoRoot, name), basePath, onWarn);
    if (cfg !== undefined) return cfg;
  }
  return undefined;
}
