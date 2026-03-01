import { describe, it, expect } from "vitest";
import { shouldIncludeFile } from "./filter.js";

describe("shouldIncludeFile", () => {
  const defaults = {
    extensions: [".ts", ".tsx", ".js"],
    ignoreDirs: ["node_modules", ".git", "dist"],
    maxFileSizeKb: 50,
  };

  it("includes a file matching extensions", () => {
    expect(shouldIncludeFile("src/index.ts", 5, defaults)).toBe(true);
  });

  it("rejects a file with non-matching extension", () => {
    expect(shouldIncludeFile("image.png", 5, defaults)).toBe(false);
  });

  it("rejects a file inside an ignored directory", () => {
    expect(shouldIncludeFile("node_modules/foo/index.ts", 5, defaults)).toBe(false);
    expect(shouldIncludeFile(".git/config", 1, defaults)).toBe(false);
    expect(shouldIncludeFile("dist/bundle.js", 10, defaults)).toBe(false);
  });

  it("rejects a file exceeding max size", () => {
    expect(shouldIncludeFile("src/huge.ts", 100, defaults)).toBe(false);
  });

  it("includes a file at exactly the size limit", () => {
    expect(shouldIncludeFile("src/edge.ts", 50, defaults)).toBe(true);
  });

  it("handles nested paths with ignored dirs", () => {
    expect(shouldIncludeFile("packages/app/node_modules/x.ts", 1, defaults)).toBe(false);
  });

  it("does not false-positive on partial dir name matches", () => {
    expect(shouldIncludeFile("src/node_modules_helper/index.ts", 1, defaults)).toBe(true);
  });

  it("rejects files without any extension (no dot)", () => {
    expect(shouldIncludeFile("Makefile", 1, defaults)).toBe(false);
    expect(shouldIncludeFile("src/Dockerfile", 1, defaults)).toBe(false);
  });

  it("handles single-char filename without extension", () => {
    // Catches dotIdx === +1 mutation: "x" has no dot, lastIndexOf returns -1
    // With +1 mutation, -1 !== 1, so false branch taken, slice(-1) = "x", not in extensions
    // But with === false mutation (always false), it'd try to slice, which might match
    expect(shouldIncludeFile("x", 1, defaults)).toBe(false);
  });

  it("correctly extracts extension even when empty string branch is altered", () => {
    // When dotIdx === -1, the ternary should return "" (no extension)
    // If mutated to return "Stryker was here!", it won't match any extension
    // Test: a file with no extension should always be rejected
    const withAllExtensions = {
      ...defaults,
      extensions: [".ts", ".tsx", ".js", ""],
    };
    // Even with "" in extensions, a file without a dot should have ext = ""
    expect(shouldIncludeFile("Makefile", 1, withAllExtensions)).toBe(true);
  });
});
