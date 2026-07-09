import { readFileSync } from "node:fs";
import path from "node:path";
import { prepareJsonc } from "../core/jsonc.js";
import { parsePathAliasConfig, type PathAliasConfig } from "../core/tsconfig-paths.js";

export interface LoadPathAliasesOptions {
  /** Optional logger for non-ENOENT failures (default: silent). */
  onWarn?: (message: string) => void;
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "ENOENT";
}

/**
 * Load path aliases from tsconfig.json / jsconfig.json under repoRoot.
 * Shell-only (fs). Returns undefined when missing or unparsable.
 */
export function loadPathAliasesFromRepo(
  repoRoot: string,
  options: LoadPathAliasesOptions = {},
): PathAliasConfig | undefined {
  const { onWarn } = options;
  for (const name of ["tsconfig.json", "jsconfig.json"] as const) {
    const filePath = path.join(repoRoot, name);
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- repoRoot is a configured repo path
      const text = readFileSync(filePath, "utf8");
      const raw: unknown = JSON.parse(prepareJsonc(text));
      const cfg = parsePathAliasConfig(raw);
      if (cfg !== undefined) return cfg;
      onWarn?.(`${filePath}: no usable compilerOptions.paths/baseUrl`);
    } catch (error) {
      if (isEnoent(error)) continue;
      onWarn?.(
        `${filePath}: ${error instanceof Error ? error.message : "failed to load path aliases"}`,
      );
    }
  }
  return undefined;
}
