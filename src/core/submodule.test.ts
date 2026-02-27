import { describe, it, expect } from "vitest";
import {
  parseSubmoduleStatus,
  isSubmoduleChange,
  partitionDiffPaths,
} from "./submodule.js";

describe("parseSubmoduleStatus", () => {
  it("parses an initialized submodule with description", () => {
    const output = " abc1234def5678 libs/my-lib (v1.0.0)";
    const result = parseSubmoduleStatus(output);
    expect(result).toEqual([
      { path: "libs/my-lib", commit: "abc1234def5678", initialized: true },
    ]);
  });

  it("parses a modified (different commit) submodule", () => {
    const output = "+def5678abc1234 packages/other (heads/main)";
    const result = parseSubmoduleStatus(output);
    expect(result).toEqual([
      { path: "packages/other", commit: "def5678abc1234", initialized: true },
    ]);
  });

  it("parses an uninitialized submodule", () => {
    const output = "-0000000000000000 vendor/third";
    const result = parseSubmoduleStatus(output);
    expect(result).toEqual([
      { path: "vendor/third", commit: "0000000000000000", initialized: false },
    ]);
  });

  it("handles multiple submodules", () => {
    const output = [
      " abc1234 libs/my-lib (v1.0.0)",
      "+def5678 packages/other",
      "-000000 vendor/third",
    ].join("\n");
    const result = parseSubmoduleStatus(output);
    expect(result).toHaveLength(3);
    expect(result[0].path).toBe("libs/my-lib");
    expect(result[1].path).toBe("packages/other");
    expect(result[2].path).toBe("vendor/third");
  });

  it("returns empty array for empty output", () => {
    expect(parseSubmoduleStatus("")).toEqual([]);
  });

  it("skips blank lines", () => {
    const output = " abc1234 libs/my-lib\n\n+def5678 packages/other";
    const result = parseSubmoduleStatus(output);
    expect(result).toHaveLength(2);
  });

  it("marks space-prefixed and +-prefixed as initialized", () => {
    const space = " abc1234 a/path";
    const plus = "+abc1234 a/path";
    expect(parseSubmoduleStatus(space)[0].initialized).toBe(true);
    expect(parseSubmoduleStatus(plus)[0].initialized).toBe(true);
  });
});

describe("isSubmoduleChange", () => {
  const submodules = [
    { path: "libs/my-lib", commit: "abc", initialized: true },
    { path: "vendor/third", commit: "000", initialized: false },
  ];

  it("returns the matching SubmoduleInfo when path matches", () => {
    expect(isSubmoduleChange("libs/my-lib", submodules)).toEqual(submodules[0]);
  });

  it("returns undefined for a path that is not a submodule", () => {
    expect(isSubmoduleChange("src/index.ts", submodules)).toBeUndefined();
  });

  it("returns uninitialized submodule too", () => {
    expect(isSubmoduleChange("vendor/third", submodules)).toEqual(submodules[1]);
  });
});

describe("partitionDiffPaths", () => {
  const submodules = [
    { path: "libs/my-lib", commit: "abc", initialized: true },
    { path: "vendor/third", commit: "000", initialized: false },
  ];
  const filterFn = (p: string) => p.endsWith(".ts");

  it("separates submodule paths from regular files", () => {
    const { changedSubmodules, regularFiles } = partitionDiffPaths(
      ["libs/my-lib", "src/index.ts", "readme.md"],
      submodules,
      filterFn,
    );
    expect(changedSubmodules).toEqual([submodules[0]]);
    expect(regularFiles).toEqual(["src/index.ts"]);
  });

  it("includes uninitialized submodule changes", () => {
    const { changedSubmodules } = partitionDiffPaths(
      ["vendor/third"],
      submodules,
      filterFn,
    );
    expect(changedSubmodules).toEqual([submodules[1]]);
  });

  it("returns no submodules when diff has only regular files", () => {
    const { changedSubmodules, regularFiles } = partitionDiffPaths(
      ["src/index.ts"],
      submodules,
      filterFn,
    );
    expect(changedSubmodules).toHaveLength(0);
    expect(regularFiles).toEqual(["src/index.ts"]);
  });

  it("deduplicates repeated submodule paths", () => {
    const { changedSubmodules } = partitionDiffPaths(
      ["libs/my-lib", "libs/my-lib"],
      submodules,
      filterFn,
    );
    expect(changedSubmodules).toHaveLength(1);
  });
});
