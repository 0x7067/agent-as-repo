import { describe, expect, it } from "vitest";
import { isPathIgnoredByGitignore } from "./gitignore.js";

describe("isPathIgnoredByGitignore", () => {
  it("returns false for empty gitignore content", () => {
    expect(isPathIgnoredByGitignore("", ".claude.json")).toBe(false);
  });

  it("matches an exact filename pattern", () => {
    expect(isPathIgnoredByGitignore(".claude.json\n", ".claude.json")).toBe(true);
  });

  it("does not match an unrelated pattern", () => {
    expect(isPathIgnoredByGitignore("node_modules\ndist/\n", ".claude.json")).toBe(false);
  });

  it("matches via a wildcard pattern", () => {
    expect(isPathIgnoredByGitignore("*.json\n", ".claude.json")).toBe(true);
  });

  it("matches a root-anchored pattern", () => {
    expect(isPathIgnoredByGitignore("/.claude.json\n", ".claude.json")).toBe(true);
  });

  it("ignores comments and blank lines", () => {
    const content = ["# secrets", "", "  ", "*.env"].join("\n");
    expect(isPathIgnoredByGitignore(content, ".claude.json")).toBe(false);
  });

  it("respects negation to un-ignore a previously matched pattern", () => {
    const content = ["*.json", "!.claude.json"].join("\n");
    expect(isPathIgnoredByGitignore(content, ".claude.json")).toBe(false);
  });

  it("applies later patterns over earlier ones (last match wins)", () => {
    const content = ["!.claude.json", "*.json"].join("\n");
    expect(isPathIgnoredByGitignore(content, ".claude.json")).toBe(true);
  });

  it("does not treat a directory-only pattern as matching a root file", () => {
    expect(isPathIgnoredByGitignore("claude.json/\n", ".claude.json")).toBe(false);
  });
});
