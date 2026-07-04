import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ChecksumsManifest } from "./build-grammar-wasm.js";

/**
 * Shell test (real fs, no mocks — per this repo's shell-test conventions): verifies the wasm files
 * actually committed under vendor/wasm/ match what vendor/wasm/checksums.json claims. Catches drift
 * where someone edits/replaces a vendored wasm without re-running scripts/build-grammar-wasm.ts
 * (or vice versa — a checksums.json edited by hand without the file actually changing).
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = path.join(packageRoot, "vendor", "wasm");

function sha256OfFile(filePath: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath is built from the fixed checksums.json + vendorDir, not external input
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

describe("vendor/wasm/checksums.json", () => {
  it("matches the sha256 of every vendored grammar wasm file it lists", () => {
    const checksumsPath = path.join(vendorDir, "checksums.json");
    const manifest = JSON.parse(readFileSync(checksumsPath, "utf8")) as ChecksumsManifest;

    // eslint-disable-next-line unicorn/no-array-sort
    expect(Object.keys(manifest).sort((a, b) => a.localeCompare(b))).toEqual(["kotlin", "swift"]);

    for (const entry of Object.values(manifest)) {
      const wasmPath = path.join(vendorDir, entry.file);
      expect(sha256OfFile(wasmPath)).toBe(entry.sha256);
    }
  });
});
