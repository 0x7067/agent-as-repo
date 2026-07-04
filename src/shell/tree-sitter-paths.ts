import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GrammarLabel } from "../core/tree-sitter-chunker.js";

export interface TreeSitterWasmPaths {
  webTreeSitterWasm: string;
  grammarWasmByLabel: Record<GrammarLabel, string>;
}

/** Package name and wasm filename for each supported grammar, relative to `node_modules/`. */
const GRAMMAR_PACKAGE_INFO: Record<GrammarLabel, { pkg: string; file: string }> = {
  typescript: { pkg: "tree-sitter-typescript", file: "tree-sitter-typescript.wasm" },
  tsx: { pkg: "tree-sitter-typescript", file: "tree-sitter-tsx.wasm" },
  javascript: { pkg: "tree-sitter-javascript", file: "tree-sitter-javascript.wasm" },
  python: { pkg: "tree-sitter-python", file: "tree-sitter-python.wasm" },
  go: { pkg: "tree-sitter-go", file: "tree-sitter-go.wasm" },
  java: { pkg: "tree-sitter-java", file: "tree-sitter-java.wasm" },
  ruby: { pkg: "tree-sitter-ruby", file: "tree-sitter-ruby.wasm" },
  rust: { pkg: "tree-sitter-rust", file: "tree-sitter-rust.wasm" },
  php: { pkg: "tree-sitter-php", file: "tree-sitter-php.wasm" },
  c: { pkg: "tree-sitter-c", file: "tree-sitter-c.wasm" },
  cpp: { pkg: "tree-sitter-cpp", file: "tree-sitter-cpp.wasm" },
  // Package name uses a hyphen, but the shipped wasm filename uses an underscore.
  csharp: { pkg: "tree-sitter-c-sharp", file: "tree-sitter-c_sharp.wasm" },
};

const WEB_TREE_SITTER_ASSET_KEY = "web-tree-sitter.wasm";
const WEB_TREE_SITTER_NODE_MODULES_PATH = path.join("web-tree-sitter", "web-tree-sitter.wasm");

/**
 * Every wasm file the tree-sitter chunker needs at runtime: the web-tree-sitter
 * engine plus one grammar per supported language. The SEA blob-asset key and
 * the materialized cache filename are both the wasm file's basename — every
 * basename here is unique (including the C# underscore filename), so it
 * doubles as a stable, collision-free asset key.
 *
 * This is the single source of truth for "which wasm files does SEA need to
 * stage" — scripts/gen-sea-config.ts imports it to build the SEA asset
 * manifest, so a new grammar added to GRAMMAR_PACKAGE_INFO is automatically
 * picked up by the SEA build without a second list to keep in sync.
 */
export function listWasmAssets(): { assetKey: string; nodeModulesPath: string }[] {
  const grammarAssets = Object.values(GRAMMAR_PACKAGE_INFO).map(({ pkg, file }) => ({
    assetKey: file,
    nodeModulesPath: path.join(pkg, file),
  }));
  return [{ assetKey: WEB_TREE_SITTER_ASSET_KEY, nodeModulesPath: WEB_TREE_SITTER_NODE_MODULES_PATH }, ...grammarAssets];
}

export function resolvePackageRoot(fromModuleUrl = import.meta.url): string {
  return path.resolve(fileURLToPath(new URL("../..", fromModuleUrl)));
}

/** Node_modules-based resolution: plain `pnpm build` dist output and dev (`tsx`) execution. */
function resolveFromNodeModules(packageRoot: string): TreeSitterWasmPaths {
  const entries = Object.entries(GRAMMAR_PACKAGE_INFO) as [GrammarLabel, { pkg: string; file: string }][];
  const grammarWasmByLabel = Object.fromEntries(
    entries.map(([label, { pkg, file }]) => [label, path.join(packageRoot, "node_modules", pkg, file)]),
  ) as Record<GrammarLabel, string>;

  return {
    webTreeSitterWasm: path.join(packageRoot, "node_modules", WEB_TREE_SITTER_NODE_MODULES_PATH),
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
  // dir is enough — no platform/arch/node-version key needed.
  return path.join(homedir(), ".repo-expert", "wasm");
}

/**
 * dlopen isn't involved here (web-tree-sitter just needs a real file path to
 * read), but assets still need to land on disk once per cache dir.
 * (Mirrors src/shell/sqlite-native.ts's `extractSeaAsset`.)
 */
function extractSeaAsset(sea: SeaApi, assetKey: string, targetPath: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- target is inside the app-owned wasm cache dir
  if (existsSync(targetPath)) return;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- target is inside the app-owned wasm cache dir
  writeFileSync(targetPath, Buffer.from(sea.getRawAsset(assetKey)));
}

function resolveFromSea(sea: SeaApi, cacheDir: string): TreeSitterWasmPaths {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- app-owned wasm cache dir
  mkdirSync(cacheDir, { recursive: true });

  const extract = (assetKey: string): string => {
    const targetPath = path.join(cacheDir, assetKey);
    extractSeaAsset(sea, assetKey, targetPath);
    return targetPath;
  };

  const webTreeSitterWasm = extract(WEB_TREE_SITTER_ASSET_KEY);
  const entries = Object.entries(GRAMMAR_PACKAGE_INFO) as [GrammarLabel, { pkg: string; file: string }][];
  const grammarWasmByLabel = Object.fromEntries(
    entries.map(([label, { file }]) => [label, extract(file)]),
  ) as Record<GrammarLabel, string>;

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
