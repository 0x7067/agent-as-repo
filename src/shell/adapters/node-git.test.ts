import { describe, it, expect, vi } from "vitest";
import { nodeGit } from "./node-git.js";
import type { GitPort } from "../../ports/git.js";
import { execFileSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);
const TEST_REPO_PATH = "/some/path";

describe("nodeGit adapter", () => {
  it("satisfies GitPort interface", () => {
    const port: GitPort = nodeGit;
    expect(typeof port.submoduleStatus).toBe("function");
  });

  it("calls git with correct submodule status args", () => {
    mockedExecFileSync.mockReturnValue("");
    nodeGit.submoduleStatus(TEST_REPO_PATH);
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["submodule", "status"],
      expect.objectContaining({ cwd: TEST_REPO_PATH }),
    );
  });

  it("passes encoding utf8 to execFileSync", () => {
    mockedExecFileSync.mockReturnValue("");
    nodeGit.submoduleStatus(TEST_REPO_PATH);
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  it("returns trimmed output from git", () => {
    mockedExecFileSync.mockReturnValue("  some status output  ");
    const result = nodeGit.submoduleStatus(TEST_REPO_PATH);
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

  it("satisfies GitPort interface with commitExists and logNameStatus", () => {
    const port: GitPort = nodeGit;
    expect(typeof port.commitExists).toBe("function");
    expect(typeof port.logNameStatus).toBe("function");
  });

  it("commitExists calls git cat-file -e <sha>^{commit} and returns true on success", () => {
    mockedExecFileSync.mockReturnValue("");
    const result = nodeGit.commitExists("/repo", "abc123");
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["cat-file", "-e", "abc123^{commit}"],
      expect.objectContaining({ cwd: "/repo", encoding: "utf8" }),
    );
    expect(result).toBe(true);
  });

  it("commitExists returns false when git fails", () => {
    mockedExecFileSync.mockImplementation(() => { throw new Error("no such commit"); });
    expect(nodeGit.commitExists("/repo", "deadbeef")).toBe(false);
  });

  it("logNameStatus calls git log with <from>..HEAD for a range source", () => {
    mockedExecFileSync.mockReturnValue("abc1234 msg\nM\tsrc/a.ts\n");
    const result = nodeGit.logNameStatus("/repo", { kind: "range", from: "abc123" });
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["--no-pager", "log", "--name-status", "--oneline", "abc123..HEAD"],
      expect.objectContaining({ cwd: "/repo", encoding: "utf8", maxBuffer: 1024 * 1024 }),
    );
    expect(result).toBe("abc1234 msg\nM\tsrc/a.ts\n");
  });

  it("logNameStatus calls git log with --since=<date> for a since source", () => {
    mockedExecFileSync.mockReturnValue("");
    nodeGit.logNameStatus("/repo", { kind: "since", date: "2026-01-01T00:00:00.000Z" });
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["--no-pager", "log", "--name-status", "--oneline", "--since=2026-01-01T00:00:00.000Z"],
      expect.objectContaining({ cwd: "/repo" }),
    );
  });

  it("logNameStatus calls git log with --max-count=<n> for a recent source", () => {
    mockedExecFileSync.mockReturnValue("");
    nodeGit.logNameStatus("/repo", { kind: "recent", count: 20 });
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["--no-pager", "log", "--name-status", "--oneline", "--max-count=20"],
      expect.objectContaining({ cwd: "/repo" }),
    );
  });

  it("logNameStatus returns empty string when git fails", () => {
    mockedExecFileSync.mockImplementation(() => { throw new Error("git error"); });
    expect(nodeGit.logNameStatus("/repo", { kind: "recent", count: 20 })).toBe("");
  });
});
