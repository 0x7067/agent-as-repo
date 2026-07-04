import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * (Re)builds the two vendored grammar wasm files this repo can't get any other way: Kotlin
 * (fwcd/tree-sitter-kotlin) and Swift (alex-pinkus/tree-sitter-swift) ship grammar *source* plus
 * native prebuilds in their npm packages, but no `.wasm` at all — unlike every other grammar this
 * repo uses, which resolves its wasm straight from node_modules (see
 * src/shell/tree-sitter-paths.ts's GRAMMAR_PACKAGE_INFO).
 *
 * Two build paths, tried in order:
 *
 * 1. **Self-build** via the `tree-sitter` CLI's `build --wasm` (devDependency `tree-sitter-cli`).
 *    Since CLI 0.26.1 this downloads a WASI SDK and needs no Docker/Emscripten. This is the
 *    reproducible, third-party-trust-free path recommended by
 *    docs/plans/2026-07-04-tree-sitter-multi-language-research.md, and the one this script always
 *    tries first.
 * 2. **Fallback**: copy the prebuilt wasm out of the `@lumis-sh/wasm-kotlin` /
 *    `@lumis-sh/wasm-swift` npm packages (devDependencies here for exactly this purpose — kept
 *    pinned so the copy is reproducible). Used when the CLI build can't run (e.g. this repo's
 *    sandboxed CI/dev environment blocks the WASI SDK / tree-sitter-cli binary download from
 *    GitHub releases — see the Slice 3 implementation report for the exact 403 encountered).
 *    `tree-sitter-wasms` (the other fallback the research doc lists) was tried first and rejected:
 *    its kotlin/swift wasm use the pre-2021 Emscripten `dylink` custom-section name, which the
 *    `web-tree-sitter` 0.26.x runtime in this repo can't load at all (`dylink.0` only) — a hard
 *    load-time failure, not just a staleness concern.
 *
 * Either way, the result is checksummed into vendor/wasm/checksums.json (sha256 + provenance), so
 * `scripts/tree-sitter-vendor-checksums.test.ts`
 * can catch drift between the committed wasm and this script's output.
 */

interface GrammarBuildSpec {
  label: "kotlin" | "swift";
  grammarPackage: string;
  grammarVersion: string;
  wasmFile: string;
  fallbackPackage: string;
}

const GRAMMAR_BUILD_SPECS: GrammarBuildSpec[] = [
  {
    label: "kotlin",
    grammarPackage: "tree-sitter-kotlin",
    grammarVersion: "0.3.8",
    wasmFile: "tree-sitter-kotlin.wasm",
    fallbackPackage: "@lumis-sh/wasm-kotlin",
  },
  {
    label: "swift",
    grammarPackage: "tree-sitter-swift",
    grammarVersion: "0.7.1",
    wasmFile: "tree-sitter-swift.wasm",
    fallbackPackage: "@lumis-sh/wasm-swift",
  },
];

export interface ChecksumEntry {
  file: string;
  sha256: string;
  source: "self-build" | "fallback-prebuilt";
  sourcePackage: string;
  sourcePackageVersion: string;
  grammarVersion: string;
  buildTool: string;
  builtAt: string;
  /** Path (relative to this file's directory) to the MIT attribution chain covering this wasm's
   * upstream grammar author and (for the fallback-prebuilt path) the repackaging author. */
  notice: string;
}

export type ChecksumsManifest = Record<string, ChecksumEntry>;

function sha256OfFile(filePath: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath is derived from the fixed GRAMMAR_BUILD_SPECS list, not external input
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function packageVersion(packageRoot: string, pkg: string): string {
  const pkgJsonPath = path.join(packageRoot, "node_modules", pkg, "package.json");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- pkgJsonPath is derived from the fixed GRAMMAR_BUILD_SPECS list, not external input
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { version: string };
  return pkgJson.version;
}

/**
 * Try `tree-sitter build --wasm` from the grammar package's own root (so the CLI picks up its
 * grammar.js/src/tree-sitter.json the way it expects). Returns false (rather than throwing) on any
 * failure — the CLI binary being missing/undownloadable is the common failure mode in restricted
 * network environments, and is not fatal here since the fallback path can still produce a working
 * wasm.
 */
function trySelfBuild(packageRoot: string, spec: GrammarBuildSpec, destPath: string): boolean {
  const cliBin = path.join(packageRoot, "node_modules", ".bin", "tree-sitter");
  const grammarDir = path.join(packageRoot, "node_modules", spec.grammarPackage);
  try {
    execFileSync(cliBin, ["build", "--wasm", "-o", destPath, grammarDir], { stdio: "pipe" });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- destPath is derived from the fixed GRAMMAR_BUILD_SPECS list, not external input
    return existsSync(destPath);
  } catch {
    return false;
  }
}

function fallbackCopy(packageRoot: string, spec: GrammarBuildSpec, destPath: string): void {
  const source = path.join(packageRoot, "node_modules", spec.fallbackPackage, spec.wasmFile);
  copyFileSync(source, destPath);
}

/** The fallback packages record which upstream grammar revision their wasm was actually built
 * from (`lumis.upstreamVersion` in their own package.json) — this can be newer than the
 * `spec.grammarVersion` devDependency pin used for the self-build path, so prefer it when
 * available rather than silently misreporting provenance. */
function fallbackUpstreamGrammarVersion(packageRoot: string, spec: GrammarBuildSpec): string {
  const pkgJsonPath = path.join(packageRoot, "node_modules", spec.fallbackPackage, "package.json");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- pkgJsonPath is derived from the fixed GRAMMAR_BUILD_SPECS list, not external input
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { lumis?: { upstreamVersion?: string } };
  return pkgJson.lumis?.upstreamVersion ?? spec.grammarVersion;
}

function buildOne(packageRoot: string, vendorDir: string, spec: GrammarBuildSpec): ChecksumEntry {
  const destPath = path.join(vendorDir, spec.wasmFile);
  const selfBuilt = trySelfBuild(packageRoot, spec, destPath);

  if (!selfBuilt) {
    fallbackCopy(packageRoot, spec, destPath);
  }

  return {
    file: spec.wasmFile,
    sha256: sha256OfFile(destPath),
    source: selfBuilt ? "self-build" : "fallback-prebuilt",
    sourcePackage: selfBuilt ? spec.grammarPackage : spec.fallbackPackage,
    sourcePackageVersion: selfBuilt
      ? packageVersion(packageRoot, spec.grammarPackage)
      : packageVersion(packageRoot, spec.fallbackPackage),
    grammarVersion: selfBuilt ? spec.grammarVersion : fallbackUpstreamGrammarVersion(packageRoot, spec),
    buildTool: selfBuilt
      ? `tree-sitter-cli ${packageVersion(packageRoot, "tree-sitter-cli")}`
      : `${spec.fallbackPackage} ${packageVersion(packageRoot, spec.fallbackPackage)} (prebuilt with tree-sitter-cli 0.26.x, per its own provenance metadata)`,
    builtAt: new Date().toISOString(),
    notice: "NOTICE",
  };
}

function main(): void {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const vendorDir = path.join(packageRoot, "vendor", "wasm");

  const manifest: ChecksumsManifest = {};
  for (const spec of GRAMMAR_BUILD_SPECS) {
    const entry = buildOne(packageRoot, vendorDir, spec);
    manifest[spec.label] = entry;
    console.log(`${spec.label}: ${entry.source} (${entry.sourcePackage}@${entry.sourcePackageVersion}) -> ${entry.sha256}`);
  }

  const checksumsPath = path.join(vendorDir, "checksums.json");
  writeFileSync(checksumsPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote ${checksumsPath}`);
}

// Stryker disable BlockStatement,ConditionalExpression,EqualityOperator,StringLiteral -- entry-point guard is untestable in unit tests
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
// Stryker restore BlockStatement,ConditionalExpression,EqualityOperator,StringLiteral
