import { describe, it, expect } from "vitest";
import { hashFileContent, shouldReindexFile } from "./content-hash.js";

describe("hashFileContent", () => {
  it("returns a sha256 hex digest", () => {
    expect(hashFileContent("hello")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for the same content", () => {
    expect(hashFileContent("same")).toBe(hashFileContent("same"));
  });

  it("changes when content changes", () => {
    expect(hashFileContent("a")).not.toBe(hashFileContent("b"));
  });

  it("hashes empty content deterministically", () => {
    expect(hashFileContent("")).toBe(hashFileContent(""));
  });
});

describe("shouldReindexFile", () => {
  it("returns true when there is no previous hash", () => {
    expect(shouldReindexFile(undefined, "abc")).toBe(true);
    expect(shouldReindexFile(null, "abc")).toBe(true);
  });

  it("returns false when hashes match", () => {
    expect(shouldReindexFile("abc", "abc")).toBe(false);
  });

  it("returns true when hashes differ", () => {
    expect(shouldReindexFile("abc", "def")).toBe(true);
  });
});
