import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listWasmAssets } from "../src/shell/tree-sitter-paths.js";

/**
 * Stages every tree-sitter wasm file as a `dist/wasm/<asset-key>` copy and
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

const NATIVE_ASSETS: Record<string, string> = {
  "better_sqlite3.node": "dist/native/better_sqlite3.node",
  vec0: "dist/native/vec0",
};

const SEA_CONFIG_FILES = ["sea-config-cli.json", "sea-config-mcp.json"];

function main(): void {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const wasmDir = path.join(packageRoot, "dist", "wasm");
  mkdirSync(wasmDir, { recursive: true });

  const wasmAssets: Record<string, string> = {};
  for (const { assetKey, nodeModulesPath } of listWasmAssets()) {
    const source = path.join(packageRoot, "node_modules", nodeModulesPath);
    const dest = path.join(wasmDir, assetKey);
    copyFileSync(source, dest);
    wasmAssets[assetKey] = path.relative(packageRoot, dest);
  }

  const assets = { ...NATIVE_ASSETS, ...wasmAssets };

  for (const configFile of SEA_CONFIG_FILES) {
    const configPath = path.join(packageRoot, configFile);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- configPath is built from the fixed SEA_CONFIG_FILES list, not external input
    const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    config["assets"] = assets;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- configPath is built from the fixed SEA_CONFIG_FILES list, not external input
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  }

  console.log(
    `Staged ${String(Object.keys(assets).length)} SEA blob assets `
    + `(${String(Object.keys(wasmAssets).length)} wasm) into ${SEA_CONFIG_FILES.join(", ")}.`,
  );
}

main();
