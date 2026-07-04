import { describe, expect, it } from "vitest";
import { BINARY_ASSET_GROUPS, computeAssetsForBinary, NATIVE_ASSETS, type BinaryAssetGroup } from "./gen-sea-config.js";

const wasmAssets = { "tree-sitter-python.wasm": "dist/wasm/tree-sitter-python.wasm" };
const manifestAsset = { "wasm-manifest.json": "dist/wasm/wasm-manifest.json" };

function requireGroup(configFile: string): BinaryAssetGroup {
  const group = BINARY_ASSET_GROUPS[configFile];
  if (!group) throw new Error(`missing BINARY_ASSET_GROUPS entry for ${configFile}`);
  return group;
}

describe("computeAssetsForBinary", () => {
  it("gives the CLI binary native assets, wasm assets, and the wasm version manifest", () => {
    const assets = computeAssetsForBinary(requireGroup("sea-config-cli.json"), wasmAssets, manifestAsset);

    expect(assets).toEqual({ ...NATIVE_ASSETS, ...wasmAssets, ...manifestAsset });
  });

  it("gives the MCP binary only native assets — src/mcp-server.ts never reaches resolveTreeSitterWasmPaths/initTreeSitterChunker", () => {
    const assets = computeAssetsForBinary(requireGroup("sea-config-mcp.json"), wasmAssets, manifestAsset);

    expect(assets).toEqual(NATIVE_ASSETS);
    expect(Object.keys(assets)).not.toContain("wasm-manifest.json");
    expect(Object.keys(assets)).not.toContain("tree-sitter-python.wasm");
  });
});
