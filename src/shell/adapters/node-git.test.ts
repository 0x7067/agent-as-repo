import { describe, it, expect } from "vitest";
import { nodeGit } from "./node-git.js";
import type { GitPort } from "../../ports/git.js";

describe("nodeGit adapter", () => {
  it("satisfies GitPort interface", () => {
    const port: GitPort = nodeGit;
    expect(typeof port.submoduleStatus).toBe("function");
  });

  it("returns a string when called on the current repo", () => {
    const result = nodeGit.submoduleStatus(process.cwd());
    expect(typeof result).toBe("string");
  });

  it("returns empty string for a non-repo path", () => {
    const result = nodeGit.submoduleStatus("/nonexistent-path-xyz");
    expect(result).toBe("");
  });
});
