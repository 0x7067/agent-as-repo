import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildWasmManifest, listWasmAssets, WASM_MANIFEST_ASSET_KEY } from "../src/shell/tree-sitter-paths.js";

/**
 * Stages every tree-sitter wasm file as a `dist/wasm/<asset-key>` copy, a
 * `dist/wasm/wasm-manifest.json` version manifest (see
 * src/shell/tree-sitter-paths.ts's `buildWasmManifest` — lets the runtime
 * detect a stale on-disk cache after a grammar package upgrade), and
 * (re)writes the "assets" section of sea-config-cli.json / sea-config-mcp.json
 * to match. The wasm list is driven entirely by
 * src/shell/tree-sitter-paths.ts's `listWasmAssets()` (itself derived from
 * GRAMMAR_PACKAGE_INFO) so a new grammar can't silently miss the SEA build —
 * add it there once and this script, build-sea.sh, and the runtime SEA
 * resolver in tree-sitter-paths.ts all pick it up.
 *
 * Native addon assets (better_sqlite3.node, vec0) are staged separately by
 * build-sea.sh (see src/shell/sqlite-native.ts); their keys/paths are small
 * and stable enough to list here directly rather than plumb through.
 */

export const NATIVE_ASSETS: Record<string, string> = {
  "better_sqlite3.node": "dist/native/better_sqlite3.node",
  vec0: "dist/native/vec0",
};

export interface BinaryAssetGroup {
  /** better_sqlite3.node + vec0 — both binaries open the sqlite-vec passage store. */
  native: boolean;
  /** web-tree-sitter + grammar wasm + the version manifest. */
  wasm: boolean;
}

/**
 * Which asset groups each SEA binary needs. src/cli.ts is the only entry
 * point that reaches resolveTreeSitterWasmPaths/initTreeSitterChunker (see
 * src/shell/tree-sitter-paths.ts, src/core/tree-sitter-chunker.ts); the MCP
 * server's tool surface (src/mcp-server.ts) never imports tree-sitter at
 * all, so bundling ~18MB of grammar wasm into it would be pure waste. This
 * mapping is the single place that decides which binary gets which assets —
 * add a new binary/asset group here rather than duplicating the copy logic.
 */
export const BINARY_ASSET_GROUPS: Record<string, BinaryAssetGroup | undefined> = {
  "sea-config-cli.json": { native: true, wasm: true },
  "sea-config-mcp.json": { native: true, wasm: false },
};

/** Pure: picks the asset map for one binary out of the precomputed native/wasm/manifest asset maps. */
export function computeAssetsForBinary(
  group: BinaryAssetGroup,
  wasmAssets: Record<string, string>,
  manifestAsset: Record<string, string>,
): Record<string, string> {
  const assets: Record<string, string> = {};
  if (group.native) Object.assign(assets, NATIVE_ASSETS);
  if (group.wasm) Object.assign(assets, wasmAssets, manifestAsset);
  return assets;
}

function main(): void {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const wasmDir = path.join(packageRoot, "dist", "wasm");
  mkdirSync(wasmDir, { recursive: true });

  const wasmAssets: Record<string, string> = {};
  for (const { assetKey, relativePath } of listWasmAssets()) {
    const source = path.join(packageRoot, relativePath);
    const dest = path.join(wasmDir, assetKey);
    copyFileSync(source, dest);
    wasmAssets[assetKey] = path.relative(packageRoot, dest);
  }

  const manifestFilePath = path.join(wasmDir, "wasm-manifest.json");
  writeFileSync(manifestFilePath, JSON.stringify(buildWasmManifest(packageRoot), null, 2) + "\n");
  const manifestAsset: Record<string, string> = {
    [WASM_MANIFEST_ASSET_KEY]: path.relative(packageRoot, manifestFilePath),
  };

  for (const [configFile, group] of Object.entries(BINARY_ASSET_GROUPS)) {
    if (!group) continue;
    const assets = computeAssetsForBinary(group, wasmAssets, manifestAsset);

    const configPath = path.join(packageRoot, configFile);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- configPath is built from the fixed BINARY_ASSET_GROUPS keys, not external input
    const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    config["assets"] = assets;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- configPath is built from the fixed BINARY_ASSET_GROUPS keys, not external input
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

    console.log(
      `Staged ${String(Object.keys(assets).length)} SEA blob assets `
      + `(${String(group.wasm ? Object.keys(wasmAssets).length : 0)} wasm) into ${configFile}.`,
    );
  }
}

// Stryker disable BlockStatement,ConditionalExpression,EqualityOperator,StringLiteral -- entry-point guard is untestable in unit tests
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
// Stryker restore BlockStatement,ConditionalExpression,EqualityOperator,StringLiteral
