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
});
