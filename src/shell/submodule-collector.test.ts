import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GitPort } from "../ports/git.js";

vi.mock("./file-collector.js", () => ({
  collectFiles: vi.fn(),
}));

import { collectFiles } from "./file-collector.js";
import { listSubmodules, expandSubmoduleFiles } from "./submodule-collector.js";
import type { RepoConfig, SubmoduleInfo } from "../core/types.js";

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
  it("returns parsed submodules from git output", () => {
    const mockGit: GitPort = {
      submoduleStatus: () =>
        " abc1234 libs/my-lib (v1.0.0)\n+def5678 packages/other (heads/main)\n",
    };
    const result = listSubmodules("/repo", mockGit);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ path: "libs/my-lib", commit: "abc1234", initialized: true });
    expect(result[1]).toEqual({ path: "packages/other", commit: "def5678", initialized: true });
  });

  it("passes repoPath to the git port", () => {
    const submoduleStatus = vi.fn().mockReturnValue("");
    const mockGit: GitPort = { submoduleStatus };
    listSubmodules("/my/repo", mockGit);
    expect(submoduleStatus).toHaveBeenCalledWith("/my/repo");
  });

  it("returns empty array when repo has no submodules (empty output)", () => {
    const mockGit: GitPort = { submoduleStatus: () => "" };
    expect(listSubmodules("/repo", mockGit)).toEqual([]);
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
