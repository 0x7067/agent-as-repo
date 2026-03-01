import { describe, it, expect, vi } from "vitest";
import { nodeGit } from "./node-git.js";
import type { GitPort } from "../../ports/git.js";
import { execFileSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

describe("nodeGit adapter", () => {
  it("satisfies GitPort interface", () => {
    const port: GitPort = nodeGit;
    expect(typeof port.submoduleStatus).toBe("function");
  });

  it("calls git with correct submodule status args", () => {
    mockedExecFileSync.mockReturnValue("");
    nodeGit.submoduleStatus("/some/path");
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["submodule", "status"],
      expect.objectContaining({ cwd: "/some/path" }),
    );
  });

  it("passes encoding utf8 to execFileSync", () => {
    mockedExecFileSync.mockReturnValue("");
    nodeGit.submoduleStatus("/some/path");
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  it("returns trimmed output from git", () => {
    mockedExecFileSync.mockReturnValue("  some status output  ");
    const result = nodeGit.submoduleStatus("/some/path");
    expect(result).toBe("  some status output  ");
  });

  it("returns empty string for a non-repo path (git fails)", () => {
    mockedExecFileSync.mockImplementation(() => { throw new Error("not a git repo"); });
    const result = nodeGit.submoduleStatus("/nonexistent-path-xyz");
    expect(result).toBe("");
  });
});
