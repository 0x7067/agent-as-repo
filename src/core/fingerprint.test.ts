import { describe, it, expect } from "vitest";
import { fingerprintBlocks } from "./fingerprint.js";

describe("fingerprintBlocks", () => {
  it("returns a sha256 hex digest", () => {
    const hash = fingerprintBlocks({ architecture: "a", conventions: "b" });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across key order", () => {
    const a = fingerprintBlocks({ architecture: "arch text", conventions: "conv text" });
    const b = fingerprintBlocks({ conventions: "conv text", architecture: "arch text" });
    expect(a).toBe(b);
  });

  it("is sensitive to swapping label/value between two blocks", () => {
    const a = fingerprintBlocks({ architecture: "x", conventions: "y" });
    const b = fingerprintBlocks({ architecture: "y", conventions: "x" });
    expect(a).not.toBe(b);
  });

  it("changes when any single value changes", () => {
    const before = fingerprintBlocks({ architecture: "same", conventions: "same" });
    const after = fingerprintBlocks({ architecture: "same", conventions: "different" });
    expect(before).not.toBe(after);
  });

  it("does not collide across the label/value boundary (null-byte delimited)", () => {
    // Without a null-byte delimiter, "a"+"bc" and "ab"+"c" concatenate to the
    // same string ("abc") and would hash identically.
    const a = fingerprintBlocks({ a: "bc" });
    const b = fingerprintBlocks({ ab: "c" });
    expect(a).not.toBe(b);
  });

  it("hashes an empty block map deterministically", () => {
    expect(fingerprintBlocks({})).toBe(fingerprintBlocks({}));
  });
});
