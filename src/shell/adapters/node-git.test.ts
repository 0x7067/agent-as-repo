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

  it("satisfies GitPort interface with all new methods", () => {
    const port: GitPort = nodeGit;
    expect(typeof port.version).toBe("function");
    expect(typeof port.headCommit).toBe("function");
    expect(typeof port.diffFiles).toBe("function");
  });

  it("version calls git --version and returns trimmed output", () => {
    mockedExecFileSync.mockReturnValue("git version 2.39.0\n");
    const result = nodeGit.version();
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["--version"],
      expect.objectContaining({ encoding: "utf8" }),
    );
    expect(result).toBe("git version 2.39.0");
  });

  it("version throws when git is not found", () => {
    mockedExecFileSync.mockImplementation(() => { throw new Error("git not found"); });
    expect(() => nodeGit.version()).toThrow("git not found");
  });

  it("headCommit calls git rev-parse HEAD with correct cwd", () => {
    mockedExecFileSync.mockReturnValue("abc1234567890\n");
    const result = nodeGit.headCommit("/repo");
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "HEAD"],
      expect.objectContaining({ cwd: "/repo", encoding: "utf8" }),
    );
    expect(result).toBe("abc1234567890");
  });

  it("headCommit returns null when git fails", () => {
    mockedExecFileSync.mockImplementation(() => { throw new Error("not a repo"); });
    expect(nodeGit.headCommit("/not-a-repo")).toBeNull();
  });

  it("diffFiles calls git diff --name-only with since..HEAD", () => {
    mockedExecFileSync.mockReturnValue("src/a.ts\nsrc/b.ts\n");
    const result = nodeGit.diffFiles("/repo", "abc123");
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["diff", "--name-only", "abc123..HEAD"],
      expect.objectContaining({ cwd: "/repo", encoding: "utf8" }),
    );
    expect(result).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("diffFiles returns empty array when diff output is empty", () => {
    mockedExecFileSync.mockReturnValue("");
    expect(nodeGit.diffFiles("/repo", "abc123")).toEqual([]);
  });

  it("diffFiles returns null when git fails", () => {
    mockedExecFileSync.mockImplementation(() => { throw new Error("git error"); });
    expect(nodeGit.diffFiles("/repo", "abc123")).toBeNull();
  });
});
