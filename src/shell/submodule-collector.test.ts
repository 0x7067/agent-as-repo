import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("./file-collector.js", () => ({
  collectFiles: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { collectFiles } from "./file-collector.js";
import { listSubmodules, expandSubmoduleFiles } from "./submodule-collector.js";
import type { RepoConfig, SubmoduleInfo } from "../core/types.js";

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedCollectFiles = vi.mocked(collectFiles);

function makeRepoConfig(overrides?: Partial<RepoConfig>): RepoConfig {
  return {
    path: "/repo",
    description: "test",
    extensions: [".ts"],
    ignoreDirs: ["node_modules"],
    tags: [],
    maxFileSizeKb: 50,
    memoryBlockLimit: 5000,
    bootstrapOnCreate: false,
    ...overrides,
  };
}

const initializedSub: SubmoduleInfo = { path: "libs/my-lib", commit: "abc123", initialized: true };
const uninitializedSub: SubmoduleInfo = { path: "vendor/ext", commit: "000000", initialized: false };

describe("listSubmodules", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns parsed submodules from git output", () => {
    mockedExecFileSync.mockReturnValue(
      " abc1234 libs/my-lib (v1.0.0)\n+def5678 packages/other (heads/main)\n",
    );
    const result = listSubmodules("/repo");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ path: "libs/my-lib", commit: "abc1234", initialized: true });
    expect(result[1]).toEqual({ path: "packages/other", commit: "def5678", initialized: true });
  });

  it("calls git with correct args in the repo path", () => {
    mockedExecFileSync.mockReturnValue("");
    listSubmodules("/my/repo");
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["submodule", "status"],
      expect.objectContaining({ cwd: "/my/repo" }),
    );
  });

  it("returns empty array when repo has no submodules (empty output)", () => {
    mockedExecFileSync.mockReturnValue("");
    expect(listSubmodules("/repo")).toEqual([]);
  });

  it("returns empty array when git command fails", () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("not a git repository");
    });
    expect(listSubmodules("/repo")).toEqual([]);
  });
});

describe("expandSubmoduleFiles", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns submodule files with repo-root-relative paths", async () => {
    mockedCollectFiles.mockResolvedValue([
      { path: "src/index.ts", content: "x", sizeKb: 1 },
      { path: "src/util.ts", content: "y", sizeKb: 1 },
    ]);
    const paths = await expandSubmoduleFiles(makeRepoConfig(), initializedSub);
    expect(paths).toEqual(["libs/my-lib/src/index.ts", "libs/my-lib/src/util.ts"]);
  });

  it("calls collectFiles scoped to the submodule directory", async () => {
    mockedCollectFiles.mockResolvedValue([]);
    await expandSubmoduleFiles(makeRepoConfig({ path: "/repo" }), initializedSub);
    expect(mockedCollectFiles).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/repo/libs/my-lib", basePath: undefined }),
    );
  });

  it("returns empty array for uninitialized submodule", async () => {
    const paths = await expandSubmoduleFiles(makeRepoConfig(), uninitializedSub);
    expect(paths).toEqual([]);
    expect(mockedCollectFiles).not.toHaveBeenCalled();
  });

  it("does not recurse into nested submodules", async () => {
    mockedCollectFiles.mockResolvedValue([]);
    await expandSubmoduleFiles(makeRepoConfig({ includeSubmodules: true }), initializedSub);
    expect(mockedCollectFiles).toHaveBeenCalledWith(
      expect.objectContaining({ includeSubmodules: false }),
    );
  });
});
