import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GrammarLabel } from "../core/tree-sitter-chunker.js";
import { atomicWriteFileSync } from "./atomic-fs.js";

export interface TreeSitterWasmPaths {
  webTreeSitterWasm: string;
  grammarWasmByLabel: Record<GrammarLabel, string>;
}

/**
 * Where a grammar's wasm comes from at build/run time. Two kinds:
 *  - "node_modules": the grammar's own npm package ships a prebuilt wasm (resolved from
 *    `node_modules/<pkg>/<file>`).
 *  - "vendored": the grammar's npm package ships no wasm at all (true for Kotlin and Swift — see
 *    docs/architecture.md's "vendored grammars" note). The wasm is checked into `vendor/wasm/`
 *    instead, built/refreshed by `scripts/build-grammar-wasm.ts`. `version` records the upstream
 *    grammar version for the SEA wasm manifest (`buildWasmManifest`), since there's no
 *    `node_modules/<pkg>/package.json` to read a version from for these two.
 */
type GrammarSource =
  | { kind: "node_modules"; pkg: string; file: string }
  | { kind: "vendored"; file: string; version: string };

/** Package name and wasm filename (or vendored path) for each supported grammar. */
const GRAMMAR_PACKAGE_INFO: Record<GrammarLabel, GrammarSource> = {
  typescript: { kind: "node_modules", pkg: "tree-sitter-typescript", file: "tree-sitter-typescript.wasm" },
  tsx: { kind: "node_modules", pkg: "tree-sitter-typescript", file: "tree-sitter-tsx.wasm" },
  javascript: { kind: "node_modules", pkg: "tree-sitter-javascript", file: "tree-sitter-javascript.wasm" },
  python: { kind: "node_modules", pkg: "tree-sitter-python", file: "tree-sitter-python.wasm" },
  go: { kind: "node_modules", pkg: "tree-sitter-go", file: "tree-sitter-go.wasm" },
  java: { kind: "node_modules", pkg: "tree-sitter-java", file: "tree-sitter-java.wasm" },
  ruby: { kind: "node_modules", pkg: "tree-sitter-ruby", file: "tree-sitter-ruby.wasm" },
  rust: { kind: "node_modules", pkg: "tree-sitter-rust", file: "tree-sitter-rust.wasm" },
  php: { kind: "node_modules", pkg: "tree-sitter-php", file: "tree-sitter-php.wasm" },
  c: { kind: "node_modules", pkg: "tree-sitter-c", file: "tree-sitter-c.wasm" },
  cpp: { kind: "node_modules", pkg: "tree-sitter-cpp", file: "tree-sitter-cpp.wasm" },
  // Package name uses a hyphen, but the shipped wasm filename uses an underscore.
  csharp: { kind: "node_modules", pkg: "tree-sitter-c-sharp", file: "tree-sitter-c_sharp.wasm" },
  kotlin: { kind: "vendored", file: "tree-sitter-kotlin.wasm", version: "0.3.8" },
  // The vendored wasm was built from upstream grammar 0.7.3 (see vendor/wasm/checksums.json's
  // "grammarVersion") — newer than the 0.7.1 tree-sitter-swift devDependency pinned for the
  // (currently unused-in-CI) self-build path. This version is what actually shipped, so it's what
  // the SEA wasm manifest should record.
  swift: { kind: "vendored", file: "tree-sitter-swift.wasm", version: "0.7.3" },
};

/** `source`'s wasm path, relative to the package root (either `node_modules/<pkg>/<file>` or
 * `vendor/wasm/<file>`). Kept relative so both node_modules and SEA-staging callers can join it
 * against whichever package root they resolved themselves, without either caller having to know
 * which of the two directories a given grammar's wasm lives under. */
function grammarSourceRelativePath(source: GrammarSource): string {
  return source.kind === "vendored"
    ? path.join("vendor", "wasm", source.file)
    : path.join("node_modules", source.pkg, source.file);
}

const WEB_TREE_SITTER_ASSET_KEY = "web-tree-sitter.wasm";
const WEB_TREE_SITTER_RELATIVE_PATH = path.join("node_modules", "web-tree-sitter", "web-tree-sitter.wasm");

/**
 * Every wasm file the tree-sitter chunker needs at runtime: the web-tree-sitter
 * engine plus one grammar per supported language. The SEA blob-asset key and
 * the materialized cache filename are both the wasm file's basename — every
 * basename here is unique (including the C# underscore filename), so it
 * doubles as a stable, collision-free asset key.
 *
 * `relativePath` is relative to the package root (repo root) — `node_modules/<pkg>/<file>` for
 * grammars whose npm package ships its own wasm, `vendor/wasm/<file>` for the vendored ones
 * (Kotlin, Swift). Callers join it against whichever package root they resolved themselves; no
 * caller needs to know which of the two directories a given grammar's wasm lives under.
 *
 * This is the single source of truth for "which wasm files does SEA need to
 * stage" — scripts/gen-sea-config.ts imports it to build the SEA asset
 * manifest, so a new grammar added to GRAMMAR_PACKAGE_INFO is automatically
 * picked up by the SEA build without a second list to keep in sync.
 */
export function listWasmAssets(): { assetKey: string; relativePath: string }[] {
  const grammarAssets = Object.values(GRAMMAR_PACKAGE_INFO).map((source) => ({
    assetKey: source.file,
    relativePath: grammarSourceRelativePath(source),
  }));
  return [{ assetKey: WEB_TREE_SITTER_ASSET_KEY, relativePath: WEB_TREE_SITTER_RELATIVE_PATH }, ...grammarAssets];
}

export function resolvePackageRoot(fromModuleUrl = import.meta.url): string {
  return path.resolve(fileURLToPath(new URL("../..", fromModuleUrl)));
}

/** SEA asset key for the version manifest (see `buildWasmManifest`). */
export const WASM_MANIFEST_ASSET_KEY = "wasm-manifest.json";

/** Maps each wasm asset key (see `listWasmAssets`) to the exact version of the grammar it came from. */
export type WasmManifest = Record<string, string>;

/**
 * Builds the version manifest that scripts/gen-sea-config.ts embeds as the
 * `wasm-manifest.json` SEA asset. Grammar packages are pinned with caret
 * ranges, so the wasm *filename* alone doesn't change across an upgrade —
 * without this, a filename-keyed on-disk cache (see `resolveFromSea` below)
 * would serve stale bytes from a previous install forever. For node_modules-sourced grammars, the
 * installed `package.json` version is read at build time and compared against the cached manifest
 * at runtime to catch that case. Vendored grammars (Kotlin, Swift) have no `node_modules/<pkg>/package.json`
 * to read, so their version comes straight from `GRAMMAR_PACKAGE_INFO` (kept in sync with
 * `vendor/wasm/checksums.json` by `scripts/build-grammar-wasm.ts`).
 */
function nodeModulesPackageVersion(packageRoot: string, pkg: string): string {
  const pkgJsonPath = path.join(packageRoot, "node_modules", pkg, "package.json");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- pkgJsonPath is derived from the fixed, code-defined GRAMMAR_PACKAGE_INFO list, not external input
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { version: string };
  return pkgJson.version;
}

export function buildWasmManifest(packageRoot = resolvePackageRoot()): WasmManifest {
  const manifest: WasmManifest = {
    [WEB_TREE_SITTER_ASSET_KEY]: nodeModulesPackageVersion(packageRoot, "web-tree-sitter"),
  };
  for (const source of Object.values(GRAMMAR_PACKAGE_INFO)) {
    manifest[source.file] = source.kind === "vendored" ? source.version : nodeModulesPackageVersion(packageRoot, source.pkg);
  }
  return manifest;
}

/** True iff both manifests cover the same asset keys with the same versions. */
function wasmManifestsMatch(cached: WasmManifest | undefined, current: WasmManifest): boolean {
  if (!cached) return false;
  const cachedKeys = Object.keys(cached);
  const currentKeys = Object.keys(current);
  if (cachedKeys.length !== currentKeys.length) return false;
  return currentKeys.every((key) => cached[key] === current[key]);
}

/** Node_modules/vendor-based resolution: plain `pnpm build` dist output and dev (`tsx`) execution. */
function resolveFromNodeModules(packageRoot: string): TreeSitterWasmPaths {
  const entries = Object.entries(GRAMMAR_PACKAGE_INFO) as [GrammarLabel, GrammarSource][];
  const grammarWasmByLabel = Object.fromEntries(
    entries.map(([label, source]) => [label, path.join(packageRoot, grammarSourceRelativePath(source))]),
  ) as Record<GrammarLabel, string>;

  return {
    webTreeSitterWasm: path.join(packageRoot, WEB_TREE_SITTER_RELATIVE_PATH),
    grammarWasmByLabel,
  };
}

export interface SeaApi {
  isSea(): boolean;
  getRawAsset(key: string): ArrayBuffer;
}

/**
 * SEA binaries carry the wasm files as blob assets; everything else resolves
 * them from node_modules. Detection must not throw outside SEA builds.
 * (Mirrors src/shell/sqlite-native.ts's `tryGetSea`.)
 */
function tryGetSea(): SeaApi | undefined {
  try {
    const requireFromHere = createRequire(import.meta.url);
    const sea = requireFromHere("node:sea") as SeaApi;
    return sea.isSea() ? sea : undefined;
  } catch {
    return undefined;
  }
}

function defaultSeaWasmCacheDir(): string {
  // Wasm bytecode is platform/arch/Node-version independent (unlike the
  // dlopen'd native addons in sqlite-native.ts), so a single shared cache
  // dir is enough — no platform/arch/node-version key needed. Staleness
  // across a *package upgrade* under the same cache dir is instead handled
  // by the version manifest (see `buildWasmManifest` / `manifestPath` below).
  return path.join(homedir(), ".repo-expert", "wasm");
}

function manifestPath(cacheDir: string): string {
  return path.join(cacheDir, "manifest.json");
}

/** Reads the previously-committed cache manifest, if any. Missing or unparseable both mean "no valid cache". */
function readCachedManifest(cacheDir: string): WasmManifest | undefined {
  const cachedPath = manifestPath(cacheDir);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- app-owned wasm cache dir
  if (!existsSync(cachedPath)) return undefined;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- app-owned wasm cache dir
    return JSON.parse(readFileSync(cachedPath, "utf8")) as WasmManifest;
  } catch {
    return undefined;
  }
}

/**
 * dlopen isn't involved here (web-tree-sitter just needs a real file path to
 * read), but assets still need to land on disk once per cache dir. Writes
 * are atomic (see src/shell/atomic-fs.ts) so a crash mid-write never leaves
 * a truncated file at `targetPath`.
 * (Mirrors src/shell/sqlite-native.ts's `extractSeaAsset`.)
 */
function extractSeaAsset(sea: SeaApi, assetKey: string, targetPath: string): void {
  atomicWriteFileSync(targetPath, Buffer.from(sea.getRawAsset(assetKey)));
}

/**
 * Resolves every wasm path from the SEA blob assets, extracting into
 * `cacheDir` as needed.
 *
 * Cache invalidation: the binary carries a `wasm-manifest.json` asset
 * recording the exact npm package version each wasm file came from
 * (`buildWasmManifest`). If that doesn't match the manifest committed to
 * `cacheDir` on a previous run (including "no manifest was ever committed"),
 * every asset is re-extracted from the embedded blob — never trust
 * `existsSync` alone, since a same-named-but-newer wasm file from a grammar
 * upgrade would otherwise be masked by a stale cached file. The manifest is
 * only written to `cacheDir` *after* every asset has been extracted
 * successfully, so a run that crashes partway through (leaving some files
 * extracted and others missing/truncated) is detected as incomplete next
 * time and fully retried rather than being mistaken for a valid cache.
 */
function resolveFromSea(sea: SeaApi, cacheDir: string): TreeSitterWasmPaths {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- app-owned wasm cache dir
  mkdirSync(cacheDir, { recursive: true });

  const currentManifest = JSON.parse(
    Buffer.from(sea.getRawAsset(WASM_MANIFEST_ASSET_KEY)).toString("utf8"),
  ) as WasmManifest;
  const manifestIsFresh = wasmManifestsMatch(readCachedManifest(cacheDir), currentManifest);

  const extract = (assetKey: string): string => {
    const targetPath = path.join(cacheDir, assetKey);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- target is inside the app-owned wasm cache dir
    const alreadyCached = manifestIsFresh && existsSync(targetPath);
    if (!alreadyCached) {
      extractSeaAsset(sea, assetKey, targetPath);
    }
    return targetPath;
  };

  const webTreeSitterWasm = extract(WEB_TREE_SITTER_ASSET_KEY);
  const entries = Object.entries(GRAMMAR_PACKAGE_INFO) as [GrammarLabel, GrammarSource][];
  const grammarWasmByLabel = Object.fromEntries(
    entries.map(([label, { file }]) => [label, extract(file)]),
  ) as Record<GrammarLabel, string>;

  if (!manifestIsFresh) {
    atomicWriteFileSync(manifestPath(cacheDir), JSON.stringify(currentManifest));
  }

  return { webTreeSitterWasm, grammarWasmByLabel };
}

export interface ResolveTreeSitterWasmPathsOptions {
  /** node_modules resolution root; only consulted outside SEA. */
  packageRoot?: string;
  /** Injectable for tests; defaults to real `node:sea` detection. */
  sea?: SeaApi;
  /** Where SEA blob assets are materialized to disk; defaults to `~/.repo-expert/wasm`. */
  cacheDir?: string;
}

export function resolveTreeSitterWasmPaths(options: ResolveTreeSitterWasmPathsOptions = {}): TreeSitterWasmPaths {
  const sea = options.sea ?? tryGetSea();
  if (sea) {
    return resolveFromSea(sea, options.cacheDir ?? defaultSeaWasmCacheDir());
  }
  return resolveFromNodeModules(options.packageRoot ?? resolvePackageRoot());
}
