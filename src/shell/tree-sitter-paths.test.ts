import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildWasmManifest,
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

    expect(assets).toHaveLength(15);
    const keys = assets.map((a) => a.assetKey);
    expect(new Set(keys).size).toBe(15);
    expect(keys).toContain("web-tree-sitter.wasm");
    // C# ships an underscore filename despite the hyphenated package name.
    expect(keys).toContain("tree-sitter-c_sharp.wasm");
    const csharp = assets.find((a) => a.assetKey === "tree-sitter-c_sharp.wasm");
    expect(csharp?.relativePath).toBe(path.join("node_modules", "tree-sitter-c-sharp", "tree-sitter-c_sharp.wasm"));
    // PHP ships two variants; only the full (tags + HTML) one is used.
    expect(keys).toContain("tree-sitter-php.wasm");
    expect(keys).not.toContain("tree-sitter-php_only.wasm");
  });

  it("resolves Kotlin and Swift wasm from vendor/wasm, not node_modules", () => {
    const assets = listWasmAssets();

    const kotlin = assets.find((a) => a.assetKey === "tree-sitter-kotlin.wasm");
    const swift = assets.find((a) => a.assetKey === "tree-sitter-swift.wasm");
    expect(kotlin?.relativePath).toBe(path.join("vendor", "wasm", "tree-sitter-kotlin.wasm"));
    expect(swift?.relativePath).toBe(path.join("vendor", "wasm", "tree-sitter-swift.wasm"));
  });
});

function failingRequireResolve(spec: string): string {
  throw new Error(`cannot resolve ${spec}`);
}

describe("resolveTreeSitterWasmPaths (non-SEA)", () => {
  it("falls back to node_modules under the given package root when require resolution fails", () => {
    const packageRoot = "/repo-root";

    const result = resolveTreeSitterWasmPaths({ packageRoot, sea: undefined, requireResolve: failingRequireResolve });

    expect(result.webTreeSitterWasm).toBe(path.join(packageRoot, "node_modules/web-tree-sitter/web-tree-sitter.wasm"));
    expect(result.grammarWasmByLabel.python).toBe(path.join(packageRoot, "node_modules/tree-sitter-python/tree-sitter-python.wasm"));
    expect(result.grammarWasmByLabel.csharp).toBe(
      path.join(packageRoot, "node_modules/tree-sitter-c-sharp/tree-sitter-c_sharp.wasm"),
    );
    // Kotlin/Swift ship no wasm in their npm packages at all — resolved from the vendored copy
    // under vendor/wasm/, not node_modules.
    expect(result.grammarWasmByLabel.kotlin).toBe(path.join(packageRoot, "vendor/wasm/tree-sitter-kotlin.wasm"));
    expect(result.grammarWasmByLabel.swift).toBe(path.join(packageRoot, "vendor/wasm/tree-sitter-swift.wasm"));
    expect(Object.keys(result.grammarWasmByLabel)).toHaveLength(14);
  });

  it("prefers Node module resolution over the packageRoot layout (npm hoists deps above the installed package)", () => {
    // For an npm install, dependencies land in the *parent* node_modules
    // (node_modules/tree-sitter-python, not
    // node_modules/repo-expert/node_modules/tree-sitter-python), so a fixed
    // <packageRoot>/node_modules join can't find them.
    const hoistedRoot = "/hoisted/node_modules";
    const requireResolve = (spec: string): string => {
      if (spec === "web-tree-sitter/web-tree-sitter.wasm") return path.join(hoistedRoot, "web-tree-sitter", "web-tree-sitter.wasm");
      const match = /^(?<pkg>.+)\/package\.json$/.exec(spec);
      if (match?.groups) return path.join(hoistedRoot, match.groups["pkg"], "package.json");
      throw new Error(`unexpected spec ${spec}`);
    };

    const result = resolveTreeSitterWasmPaths({ packageRoot: "/repo-root", sea: undefined, requireResolve });

    expect(result.webTreeSitterWasm).toBe(path.join(hoistedRoot, "web-tree-sitter/web-tree-sitter.wasm"));
    expect(result.grammarWasmByLabel.python).toBe(path.join(hoistedRoot, "tree-sitter-python/tree-sitter-python.wasm"));
    expect(result.grammarWasmByLabel.csharp).toBe(path.join(hoistedRoot, "tree-sitter-c-sharp/tree-sitter-c_sharp.wasm"));
    // Vendored grammars ship inside the repo-expert package itself, so they
    // always resolve from the package root regardless of hoisting.
    expect(result.grammarWasmByLabel.kotlin).toBe(path.join("/repo-root", "vendor/wasm/tree-sitter-kotlin.wasm"));
  });

  it("resolves real wasm files from the dev checkout with the default require resolution", () => {
    const result = resolveTreeSitterWasmPaths({ sea: undefined });

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from module resolution against the real dev checkout
    expect(existsSync(result.webTreeSitterWasm)).toBe(true);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from module resolution against the real dev checkout
    expect(existsSync(result.grammarWasmByLabel.python)).toBe(true);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from module resolution against the real dev checkout
    expect(existsSync(result.grammarWasmByLabel.kotlin)).toBe(true);
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
    expect(wasmPaths).toHaveLength(14);
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
    // 15 wasm assets (web-tree-sitter + 14 grammars) plus one manifest read.
    expect(firstCallCount).toBe(16);

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

/** Builds a fake package root: real node_modules (symlinked, so `nodeModulesPackageVersion` can
 * still resolve every non-vendored grammar's real installed version) plus a fixture
 * vendor/wasm/checksums.json controlling what the vendored (Kotlin/Swift) entries report. */
function makeFixturePackageRoot(checksums: Record<string, { file: string; sha256: string }>): string {
  const root = makeTempDir("tree-sitter-wasm-manifest-");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- both paths are fixtures built from the real repo root and a temp dir under test
  symlinkSync(path.join(resolvePackageRoot(), "node_modules"), path.join(root, "node_modules"));
  const vendorDir = path.join(root, "vendor", "wasm");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp root under test
  mkdirSync(vendorDir, { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp root under test
  writeFileSync(path.join(vendorDir, "checksums.json"), JSON.stringify(checksums));
  return root;
}

describe("buildWasmManifest (vendored grammar versioning)", () => {
  it("derives the vendored grammars' manifest version from checksums.json's sha256, not a hand-written literal", () => {
    const root = makeFixturePackageRoot({
      kotlin: { file: "tree-sitter-kotlin.wasm", sha256: "a".repeat(64) },
      swift: { file: "tree-sitter-swift.wasm", sha256: "b".repeat(64) },
    });

    const manifest = buildWasmManifest(root);

    expect(manifest["tree-sitter-kotlin.wasm"]).toBe("a".repeat(64));
    expect(manifest["tree-sitter-swift.wasm"]).toBe("b".repeat(64));
  });

  it("changes the manifest value when checksums.json's sha256 changes (regression: a hand-written version literal would not have)", () => {
    const rootBefore = makeFixturePackageRoot({
      kotlin: { file: "tree-sitter-kotlin.wasm", sha256: "a".repeat(64) },
      swift: { file: "tree-sitter-swift.wasm", sha256: "b".repeat(64) },
    });
    const before = buildWasmManifest(rootBefore);

    // Simulates rebuilding the vendored wasm with different bytes but no corresponding bump to any
    // hand-written version literal (the exact failure mode a dead literal can't detect).
    const rootAfter = makeFixturePackageRoot({
      kotlin: { file: "tree-sitter-kotlin.wasm", sha256: "c".repeat(64) },
      swift: { file: "tree-sitter-swift.wasm", sha256: "b".repeat(64) },
    });
    const after = buildWasmManifest(rootAfter);

    expect(after["tree-sitter-kotlin.wasm"]).not.toBe(before["tree-sitter-kotlin.wasm"]);
    expect(after["tree-sitter-swift.wasm"]).toBe(before["tree-sitter-swift.wasm"]);
  });

  it("throws a clear error when checksums.json has no entry for a vendored grammar's wasm file", () => {
    const root = makeFixturePackageRoot({
      kotlin: { file: "tree-sitter-kotlin.wasm", sha256: "a".repeat(64) },
      // swift entry missing entirely.
    });

    expect(() => buildWasmManifest(root)).toThrow(/tree-sitter-swift\.wasm/);
  });
});

describe("vendor/wasm/checksums.json vs GRAMMAR_PACKAGE_INFO", () => {
  it("has a checksums.json entry for every vendored grammar's wasm file", () => {
    const checksumsPath = path.join(resolvePackageRoot(), "vendor", "wasm", "checksums.json");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- checksumsPath is derived from the fixed real repo root, not external input
    const checksums = JSON.parse(readFileSync(checksumsPath, "utf8")) as Record<string, { file: string }>;
    const checksummedFiles = new Set(Object.values(checksums).map((entry) => entry.file));

    const vendoredAssetKeys = listWasmAssets()
      .filter(({ relativePath }) => relativePath.startsWith(path.join("vendor", "wasm")))
      .map(({ assetKey }) => assetKey);

    expect(vendoredAssetKeys.length).toBeGreaterThan(0);
    for (const assetKey of vendoredAssetKeys) {
      expect(checksummedFiles.has(assetKey)).toBe(true);
    }
  });
});
