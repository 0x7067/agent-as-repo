import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listWasmAssets,
  resolvePackageRoot,
  resolveTreeSitterWasmPaths,
  type SeaApi,
} from "./tree-sitter-paths.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fakeSea(assetBytes: Record<string, string> = {}): { sea: SeaApi; getRawAsset: ReturnType<typeof vi.fn> } {
  const getRawAsset = vi.fn((key: string) => {
    const text = assetBytes[key] ?? `fake-bytes-for-${key}`;
    const buf = Buffer.from(text, "utf8");
    // Buffer.from may allocate from Node's shared pool, so `.buffer` can be a
    // much larger ArrayBuffer than the string itself — slice to the exact
    // byte range, matching what a real ArrayBuffer-returning API would give.
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });
  const sea: SeaApi = { isSea: () => true, getRawAsset };
  return { sea, getRawAsset };
}

describe("listWasmAssets", () => {
  it("includes the web-tree-sitter runtime plus one entry per grammar, all unique", () => {
    const assets = listWasmAssets();

    expect(assets).toHaveLength(13);
    const keys = assets.map((a) => a.assetKey);
    expect(new Set(keys).size).toBe(13);
    expect(keys).toContain("web-tree-sitter.wasm");
    // C# ships an underscore filename despite the hyphenated package name.
    expect(keys).toContain("tree-sitter-c_sharp.wasm");
    const csharp = assets.find((a) => a.assetKey === "tree-sitter-c_sharp.wasm");
    expect(csharp?.nodeModulesPath).toBe(path.join("tree-sitter-c-sharp", "tree-sitter-c_sharp.wasm"));
    // PHP ships two variants; only the full (tags + HTML) one is used.
    expect(keys).toContain("tree-sitter-php.wasm");
    expect(keys).not.toContain("tree-sitter-php_only.wasm");
  });
});

describe("resolveTreeSitterWasmPaths (non-SEA)", () => {
  it("resolves every grammar and the runtime wasm under node_modules of the given package root", () => {
    const packageRoot = "/repo-root";

    const result = resolveTreeSitterWasmPaths({ packageRoot, sea: undefined });

    expect(result.webTreeSitterWasm).toBe(path.join(packageRoot, "node_modules/web-tree-sitter/web-tree-sitter.wasm"));
    expect(result.grammarWasmByLabel.python).toBe(path.join(packageRoot, "node_modules/tree-sitter-python/tree-sitter-python.wasm"));
    expect(result.grammarWasmByLabel.csharp).toBe(
      path.join(packageRoot, "node_modules/tree-sitter-c-sharp/tree-sitter-c_sharp.wasm"),
    );
    expect(Object.keys(result.grammarWasmByLabel)).toHaveLength(12);
  });

  it("defaults the package root to the real resolvePackageRoot() when omitted", () => {
    const result = resolveTreeSitterWasmPaths({ sea: undefined });

    expect(result.webTreeSitterWasm).toBe(
      path.join(resolvePackageRoot(), "node_modules/web-tree-sitter/web-tree-sitter.wasm"),
    );
  });
});

describe("resolveTreeSitterWasmPaths (SEA)", () => {
  it("extracts every wasm asset into the cache dir instead of touching node_modules", () => {
    const cacheDir = makeTempDir("tree-sitter-wasm-sea-");
    const { sea } = fakeSea();

    const result = resolveTreeSitterWasmPaths({ sea, cacheDir, packageRoot: "/should-not-be-used" });

    expect(path.dirname(result.webTreeSitterWasm)).toBe(cacheDir);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp cacheDir under test
    expect(existsSync(result.webTreeSitterWasm)).toBe(true);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp cacheDir under test
    expect(readFileSync(result.webTreeSitterWasm, "utf8")).toBe("fake-bytes-for-web-tree-sitter.wasm");

    const wasmPaths = Object.values(result.grammarWasmByLabel);
    expect(wasmPaths).toHaveLength(12);
    for (const wasmPath of wasmPaths) {
      expect(path.dirname(wasmPath)).toBe(cacheDir);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp cacheDir under test
      expect(existsSync(wasmPath)).toBe(true);
      expect(wasmPath.includes("node_modules")).toBe(false);
    }

    const csharpPath = result.grammarWasmByLabel.csharp;
    expect(path.basename(csharpPath)).toBe("tree-sitter-c_sharp.wasm");
  });

  it("does not re-extract assets that are already cached", () => {
    const cacheDir = makeTempDir("tree-sitter-wasm-sea-cache-");
    const { sea, getRawAsset } = fakeSea();

    resolveTreeSitterWasmPaths({ sea, cacheDir });
    const firstCallCount = getRawAsset.mock.calls.length;
    expect(firstCallCount).toBe(13);

    resolveTreeSitterWasmPaths({ sea, cacheDir });

    expect(getRawAsset.mock.calls.length).toBe(firstCallCount);
  });

  it("prefers SEA extraction over node_modules resolution whenever isSea() is true", () => {
    const cacheDir = makeTempDir("tree-sitter-wasm-sea-priority-");
    const { sea } = fakeSea();

    const result = resolveTreeSitterWasmPaths({ sea, cacheDir, packageRoot: "/repo-root" });

    expect(result.webTreeSitterWasm.startsWith("/repo-root")).toBe(false);
  });
});
