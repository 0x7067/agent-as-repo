import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listWasmAssets,
  resolvePackageRoot,
  resolveTreeSitterWasmPaths,
  WASM_MANIFEST_ASSET_KEY,
  type SeaApi,
  type WasmManifest,
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

/** A stable baseline manifest (one fake version per real wasm asset key) for tests that don't care about specific versions. */
function baselineManifest(version = "1.0.0"): WasmManifest {
  return Object.fromEntries(listWasmAssets().map(({ assetKey }) => [assetKey, version]));
}

function textToArrayBuffer(text: string): ArrayBuffer {
  const buf = Buffer.from(text, "utf8");
  // Buffer.from may allocate from Node's shared pool, so `.buffer` can be a
  // much larger ArrayBuffer than the string itself — slice to the exact
  // byte range, matching what a real ArrayBuffer-returning API would give.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function fakeSea(
  options: { assetBytes?: Record<string, string>; manifest?: WasmManifest } = {},
): { sea: SeaApi; getRawAsset: ReturnType<typeof vi.fn> } {
  const manifest = options.manifest ?? baselineManifest();
  const assetBytes = options.assetBytes ?? {};
  const getRawAsset = vi.fn((key: string) => {
    if (key === WASM_MANIFEST_ASSET_KEY) {
      return textToArrayBuffer(JSON.stringify(manifest));
    }
    const text = assetBytes[key] ?? `fake-bytes-for-${key}`;
    return textToArrayBuffer(text);
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

  it("does not re-extract assets that are already cached and whose manifest is unchanged", () => {
    const cacheDir = makeTempDir("tree-sitter-wasm-sea-cache-");
    const { sea, getRawAsset } = fakeSea();

    resolveTreeSitterWasmPaths({ sea, cacheDir });
    const firstCallCount = getRawAsset.mock.calls.length;
    // 13 wasm assets (web-tree-sitter + 12 grammars) plus one manifest read.
    expect(firstCallCount).toBe(14);

    resolveTreeSitterWasmPaths({ sea, cacheDir });

    // Only the manifest is re-read (to confirm it still matches); no wasm
    // asset is re-extracted.
    expect(getRawAsset.mock.calls.length).toBe(firstCallCount + 1);
  });

  it("prefers SEA extraction over node_modules resolution whenever isSea() is true", () => {
    const cacheDir = makeTempDir("tree-sitter-wasm-sea-priority-");
    const { sea } = fakeSea();

    const result = resolveTreeSitterWasmPaths({ sea, cacheDir, packageRoot: "/repo-root" });

    expect(result.webTreeSitterWasm.startsWith("/repo-root")).toBe(false);
  });

  it("replaces a cached wasm file when the embedded manifest differs from the cached one (stale cache from a grammar upgrade)", () => {
    // Regression test for a version-unaware cache: a grammar package can be
    // bumped (caret range) between builds while the wasm filename stays the
    // same, so a filename-only cache key would serve the old bytes forever.
    const cacheDir = makeTempDir("tree-sitter-wasm-sea-stale-");
    const oldManifest = baselineManifest("0.24.0");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp cacheDir under test
    writeFileSync(path.join(cacheDir, "manifest.json"), JSON.stringify(oldManifest));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp cacheDir under test
    writeFileSync(path.join(cacheDir, "tree-sitter-python.wasm"), "OLD-STALE-PYTHON-CONTENT");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp cacheDir under test
    writeFileSync(path.join(cacheDir, "tree-sitter-rust.wasm"), "OLD-STALE-RUST-CONTENT");

    const newManifest = baselineManifest("0.25.0");
    const { sea } = fakeSea({ manifest: newManifest });

    const result = resolveTreeSitterWasmPaths({ sea, cacheDir });

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp cacheDir under test
    expect(readFileSync(result.grammarWasmByLabel.python, "utf8")).toBe("fake-bytes-for-tree-sitter-python.wasm");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp cacheDir under test
    expect(readFileSync(result.grammarWasmByLabel.rust, "utf8")).toBe("fake-bytes-for-tree-sitter-rust.wasm");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp cacheDir under test
    expect(readFileSync(path.join(cacheDir, "manifest.json"), "utf8")).toBe(JSON.stringify(newManifest));
  });

  it("does not re-extract when the manifest matches, even if only checked with a fresh resolver call", () => {
    const cacheDir = makeTempDir("tree-sitter-wasm-sea-match-");
    const manifest = baselineManifest("0.25.0");
    const { sea: firstSea } = fakeSea({ manifest });
    resolveTreeSitterWasmPaths({ sea: firstSea, cacheDir });

    const { sea: secondSea, getRawAsset } = fakeSea({ manifest });
    const result = resolveTreeSitterWasmPaths({ sea: secondSea, cacheDir });

    // Same manifest version -> only the manifest itself is re-read, no wasm
    // asset bytes are requested again.
    expect(getRawAsset.mock.calls.map((call) => call[0] as string)).toEqual([WASM_MANIFEST_ASSET_KEY]);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp cacheDir under test
    expect(readFileSync(result.grammarWasmByLabel.python, "utf8")).toBe("fake-bytes-for-tree-sitter-python.wasm");
  });

  it("fully recovers on the next run if extraction crashes partway through (manifest is only committed after every asset succeeds)", () => {
    // Simulates a process crash mid-extraction: some assets are written to
    // disk before the crash, but resolveTreeSitterWasmPaths throws before
    // reaching the point where it would persist the cache manifest.
    const cacheDir = makeTempDir("tree-sitter-wasm-sea-crash-");
    const manifest = baselineManifest("0.25.0");
    const getRawAsset = vi.fn((key: string) => {
      if (key === "tree-sitter-rust.wasm") {
        throw new Error("simulated crash mid-extraction");
      }
      if (key === WASM_MANIFEST_ASSET_KEY) return textToArrayBuffer(JSON.stringify(manifest));
      return textToArrayBuffer(`fake-bytes-for-${key}`);
    });
    const crashingSea: SeaApi = { isSea: () => true, getRawAsset };

    expect(() => resolveTreeSitterWasmPaths({ sea: crashingSea, cacheDir })).toThrow(
      "simulated crash mid-extraction",
    );
    // No manifest was committed, so the crash left an incomplete cache
    // rather than one that looks complete-but-stale.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp cacheDir under test
    expect(existsSync(path.join(cacheDir, "manifest.json"))).toBe(false);

    const { sea: healthySea } = fakeSea({ manifest });
    const result = resolveTreeSitterWasmPaths({ sea: healthySea, cacheDir });

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp cacheDir under test
    expect(readFileSync(result.grammarWasmByLabel.rust, "utf8")).toBe("fake-bytes-for-tree-sitter-rust.wasm");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp cacheDir under test
    expect(existsSync(path.join(cacheDir, "manifest.json"))).toBe(true);
  });

  it("fully re-extracts a truncated file left by a crash that happened before any manifest was ever committed", () => {
    // Same underlying bug as the throw-mid-extraction test above, but
    // written as "what's on disk after the crash" rather than reproducing
    // the crash itself: a partially-written file, no manifest.
    const cacheDir = makeTempDir("tree-sitter-wasm-sea-crash-artifact-");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp cacheDir under test
    writeFileSync(path.join(cacheDir, "tree-sitter-python.wasm"), "TRUNCATED-PARTIAL-WRITE");

    const { sea } = fakeSea();
    const result = resolveTreeSitterWasmPaths({ sea, cacheDir });

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp cacheDir under test
    expect(readFileSync(result.grammarWasmByLabel.python, "utf8")).toBe("fake-bytes-for-tree-sitter-python.wasm");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp cacheDir under test
    expect(existsSync(path.join(cacheDir, "manifest.json"))).toBe(true);
  });
});
