import { describe, it, expect } from "vitest";
import { resolveSafeRepoPath, toAgentPath } from "./repo-path.js";

describe("resolveSafeRepoPath", () => {
  it("resolves a relative path under the repo root", () => {
    expect(resolveSafeRepoPath("/repo", "src/a.ts")).toBe("/repo/src/a.ts");
  });

  it("normalizes ./ and redundant separators", () => {
    expect(resolveSafeRepoPath("/repo", "./src/./a.ts")).toBe("/repo/src/a.ts");
  });

  it("rejects path traversal with ..", () => {
    expect(() => resolveSafeRepoPath("/repo", "../outside.ts")).toThrow(/escapes|outside|traversal/i);
  });

  it("rejects nested traversal that escapes the root", () => {
    expect(() => resolveSafeRepoPath("/repo", "src/../../etc/passwd")).toThrow(/escapes|outside|traversal/i);
  });

  it("rejects absolute paths", () => {
    expect(() => resolveSafeRepoPath("/repo", "/etc/passwd")).toThrow(/absolute|escapes|outside/i);
  });

  it("allows paths that use .. but stay inside the root", () => {
    expect(resolveSafeRepoPath("/repo", "src/../lib/b.ts")).toBe("/repo/lib/b.ts");
  });

  it("rejects empty relative paths", () => {
    expect(() => resolveSafeRepoPath("/repo", "")).toThrow(/empty|required/i);
  });
});

describe("toAgentPath", () => {
  it("maps a repo-relative path into a configured base path", () => {
    expect(toAgentPath("packages/app/src/a.ts", "packages/app")).toBe("src/a.ts");
  });

  it("rejects paths outside the configured base path", () => {
    expect(toAgentPath("packages/other/src/a.ts", "packages/app")).toBeNull();
  });

  it("normalizes Windows separators", () => {
    expect(toAgentPath(String.raw`packages\app\src\a.ts`, "packages/app/")).toBe("src/a.ts");
  });
});
