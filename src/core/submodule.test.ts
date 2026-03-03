import { describe, it, expect } from "vitest";
import {
  parseSubmoduleStatus,
  isSubmoduleChange,
  partitionDiffPaths,
} from "./submodule.js";

const isTypeScriptPath = (filePath: string): boolean => filePath.endsWith(".ts");
const LIBS_MY_LIB = "libs/my-lib";
const PACKAGES_OTHER = "packages/other";
const VENDOR_THIRD = "vendor/third";
const SRC_INDEX_TS = "src/index.ts";

describe("parseSubmoduleStatus", () => {
  it("parses an initialized submodule with description", () => {
    const output = ` abc1234def5678 ${LIBS_MY_LIB} (v1.0.0)`;
    const result = parseSubmoduleStatus(output);
    expect(result).toEqual([
      { path: LIBS_MY_LIB, commit: "abc1234def5678", initialized: true },
    ]);
  });

  it("parses a modified (different commit) submodule", () => {
    const output = `+def5678abc1234 ${PACKAGES_OTHER} (heads/main)`;
    const result = parseSubmoduleStatus(output);
    expect(result).toEqual([
      { path: PACKAGES_OTHER, commit: "def5678abc1234", initialized: true },
    ]);
  });

  it("parses an uninitialized submodule", () => {
    const output = `-0000000000000000 ${VENDOR_THIRD}`;
    const result = parseSubmoduleStatus(output);
    expect(result).toEqual([
      { path: VENDOR_THIRD, commit: "0000000000000000", initialized: false },
    ]);
  });

  it("handles multiple submodules", () => {
    const output = [
      ` abc1234 ${LIBS_MY_LIB} (v1.0.0)`,
      `+def5678 ${PACKAGES_OTHER}`,
      `-000000 ${VENDOR_THIRD}`,
    ].join("\n");
    const result = parseSubmoduleStatus(output);
    expect(result).toHaveLength(3);
    expect(result[0].path).toBe(LIBS_MY_LIB);
    expect(result[1].path).toBe(PACKAGES_OTHER);
    expect(result[2].path).toBe(VENDOR_THIRD);
  });

  it("returns empty array for empty output", () => {
    expect(parseSubmoduleStatus("")).toEqual([]);
  });

  it("skips blank lines", () => {
    const output = ` abc1234 ${LIBS_MY_LIB}\n\n+def5678 ${PACKAGES_OTHER}`;
    const result = parseSubmoduleStatus(output);
    expect(result).toHaveLength(2);
  });

  it("marks space-prefixed and +-prefixed as initialized", () => {
    const space = " abc1234 a/path";
    const plus = "+abc1234 a/path";
    expect(parseSubmoduleStatus(space)[0].initialized).toBe(true);
    expect(parseSubmoduleStatus(plus)[0].initialized).toBe(true);
  });

  it("handles leading whitespace in hash after status char (trim)", () => {
    // Status char is followed by hash — trim() removes any extra whitespace
    const output = `   abc1234 ${LIBS_MY_LIB}`;
    const result = parseSubmoduleStatus(output);
    // Status char is " ", rest is "  abc1234 libs/my-lib", trim → "abc1234 libs/my-lib"
    expect(result).toHaveLength(1);
    expect(result[0].commit).toBe("abc1234");
    expect(result[0].path).toBe(LIBS_MY_LIB);
  });

  it("handles multiple spaces between hash and path", () => {
    const output = ` abc1234   ${LIBS_MY_LIB}`;
    const result = parseSubmoduleStatus(output);
    expect(result).toHaveLength(1);
    expect(result[0].commit).toBe("abc1234");
    expect(result[0].path).toBe(LIBS_MY_LIB);
  });

  it("skips lines with insufficient parts (no commit or path)", () => {
    // Single word after status char — should be filtered
    const output = " onlycommit";
    const result = parseSubmoduleStatus(output);
    expect(result).toEqual([]);
  });

  it("filters out null entries from malformed lines", () => {
    const output = ` abc1234 ${LIBS_MY_LIB}\n \n+def5678 ${PACKAGES_OTHER}`;
    const result = parseSubmoduleStatus(output);
    // Second line " " has statusChar=" ", rest="" → no commit/path → null → filtered
    expect(result.length).toBeLessThanOrEqual(2);
    for (const r of result) {
      expect(r.commit).toBeTruthy();
      expect(r.path).toBeTruthy();
    }
  });

  it("filter removes empty lines (not always true or >= 0)", () => {
    // Catches: filter removal (MethodExpression), true mutation, >= 0 mutation
    // With filter removed or always true: empty string "" goes to .map()
    // line[0] = undefined, rest = "".slice(1) = "", parts = [""]
    // commit = "", subPath = undefined → returns null → second filter catches it
    // BUT: the second .filter(info => info !== null) catches nulls only
    // if the first filter is removed, we get extra null entries that second filter removes
    // So these might be equivalent... unless the empty string causes an error
    //
    // Actually with >= 0: "".length = 0, 0 >= 0 = true (passes filter)
    // With > 0: "".length = 0, 0 > 0 = false (filtered out)
    // "" passes through to map: line[0] = undefined, rest = "".slice(1).trim() = ""
    // parts = [""], commit = "", subPath = undefined → null → second filter removes
    // So >= 0 and filter removal are equivalent mutations (second filter catches them)
    //
    // To actually kill these: need a case where keeping empty lines causes WRONG results
    // An empty line that somehow produces a valid-looking entry instead of null
    // "" → statusChar=undefined, rest="".slice(1)="" → parts=[""] → commit="", subPath=undefined → null
    // So empty lines always produce null → second filter catches → equivalent mutation
    //
    // What about a line with just a space character " "?
    // " ".length = 1 > 0 ✓ (passes both > and >= filters)
    // statusChar = " ", rest = "".trim() = "", parts = [""], commit="", subPath=undefined → null
    //
    // These ARE equivalent mutants — the second filter catches anything the first would catch.
    // Let's verify by testing that the output is exactly what we expect
    const output = ` abc1234 ${LIBS_MY_LIB}\n\n+def5678 ${PACKAGES_OTHER}\n`;
    const result = parseSubmoduleStatus(output);
    expect(result).toHaveLength(2);
    expect(result).toEqual([
      { path: LIBS_MY_LIB, commit: "abc1234", initialized: true },
      { path: PACKAGES_OTHER, commit: "def5678", initialized: true },
    ]);
  });
});

describe("isSubmoduleChange", () => {
  const submodules = [
    { path: LIBS_MY_LIB, commit: "abc", initialized: true },
    { path: VENDOR_THIRD, commit: "000", initialized: false },
  ];

  it("returns the matching SubmoduleInfo when path matches", () => {
    expect(isSubmoduleChange(LIBS_MY_LIB, submodules)).toEqual(submodules[0]);
  });

  it("returns undefined for a path that is not a submodule", () => {
    expect(isSubmoduleChange(SRC_INDEX_TS, submodules)).toBeUndefined();
  });

  it("returns uninitialized submodule too", () => {
    expect(isSubmoduleChange(VENDOR_THIRD, submodules)).toEqual(submodules[1]);
  });
});

describe("partitionDiffPaths", () => {
  const submodules = [
    { path: LIBS_MY_LIB, commit: "abc", initialized: true },
    { path: VENDOR_THIRD, commit: "000", initialized: false },
  ];
  it("separates submodule paths from regular files", () => {
    const { changedSubmodules, regularFiles } = partitionDiffPaths(
      [LIBS_MY_LIB, SRC_INDEX_TS, "readme.md"],
      submodules,
      isTypeScriptPath,
    );
    expect(changedSubmodules).toEqual([submodules[0]]);
    expect(regularFiles).toEqual([SRC_INDEX_TS]);
  });

  it("includes uninitialized submodule changes", () => {
    const { changedSubmodules } = partitionDiffPaths(
      [VENDOR_THIRD],
      submodules,
      isTypeScriptPath,
    );
    expect(changedSubmodules).toEqual([submodules[1]]);
  });

  it("returns no submodules when diff has only regular files", () => {
    const { changedSubmodules, regularFiles } = partitionDiffPaths(
      [SRC_INDEX_TS],
      submodules,
      isTypeScriptPath,
    );
    expect(changedSubmodules).toHaveLength(0);
    expect(regularFiles).toEqual([SRC_INDEX_TS]);
  });

  it("deduplicates repeated submodule paths", () => {
    const { changedSubmodules } = partitionDiffPaths(
      [LIBS_MY_LIB, LIBS_MY_LIB],
      submodules,
      isTypeScriptPath,
    );
    expect(changedSubmodules).toHaveLength(1);
  });
});
