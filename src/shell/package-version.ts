import { createRequire } from "node:module";

const FALLBACK_VERSION = "0.0.0";
const PACKAGE_JSON_REQUIRE_PATHS = ["../package.json", "../../package.json"] as const;

/**
 * Read the running package's version. Reads from `package.json` relative
 * to this module rather than hardcoding a string that inevitably drifts.
 * Runs from both `src/` (tsx) and the esbuild-bundled `dist/bin/*.mjs`;
 * from the SEA build, `import.meta.url` is a synthetic path and this read
 * is expected to fail — hence the fallback.
 */
export function readPackageVersion(): string {
  const requireFromHere = createRequire(import.meta.url);
  return readPackageVersionFromRequire(requireFromHere);
}

export function readPackageVersionFromRequire(requireFromHere: (id: string) => unknown): string {
  for (const packageJsonPath of PACKAGE_JSON_REQUIRE_PATHS) {
    try {
      const pkg = requireFromHere(packageJsonPath) as { version?: unknown };
      if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
    } catch {
      // Try the next layout before falling back for SEA and other synthetic paths.
    }
  }
  return FALLBACK_VERSION;
}
