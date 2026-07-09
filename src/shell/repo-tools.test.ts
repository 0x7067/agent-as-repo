import { describe, it, expect, vi } from "vitest";
import type { FileSystemPort, WatcherHandle } from "../ports/filesystem.js";
import {
  createRepoAccess,
  handleGlobFiles,
  handleGrepRepo,
  handleReadFile,
} from "./repo-tools.js";

function makeFakeFs(overrides: Partial<FileSystemPort> = {}): FileSystemPort {
  return {
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn(),
    stat: vi.fn().mockResolvedValue({ size: 10, isDirectory: () => false }),
    access: vi.fn(),
    rename: vi.fn(),
    copyFile: vi.fn(),
    glob: vi.fn().mockResolvedValue([]),
    watch: vi.fn().mockReturnValue({ close: vi.fn(), on: vi.fn() } as unknown as WatcherHandle),
    ...overrides,
  };
}

const REPO = {
  path: "/repo",
  description: "test",
  extensions: [".ts"],
  ignoreDirs: ["node_modules", ".git"],
};

describe("repo-tools handlers", () => {
  it("grep_repo returns matches from the grep runner", () => {
    const grep = vi.fn().mockReturnValue({ stdout: "src/a.ts:1:foo", exitCode: 0 });
    const access = createRepoAccess({ myrepo: REPO }, { fs: makeFakeFs(), grep });
    const result = JSON.parse(handleGrepRepo(access, "myrepo", { pattern: "foo" })) as {
      matches: string;
    };
    expect(result.matches).toContain("foo");
    expect(grep).toHaveBeenCalledWith(expect.arrayContaining(["foo"]), "/repo");
  });

  it("grep_repo rejects path traversal", () => {
    const access = createRepoAccess({ myrepo: REPO }, { fs: makeFakeFs(), grep: vi.fn() });
    const result = JSON.parse(
      handleGrepRepo(access, "myrepo", { pattern: "x", path: "../outside" }),
    ) as { error: string };
    expect(result.error).toMatch(/escapes|traversal/i);
  });

  it("grep_repo reports missing rg binary", () => {
    const access = createRepoAccess(
      { myrepo: REPO },
      {
        fs: makeFakeFs(),
        grep: () => ({
          stdout: "",
          exitCode: 127,
          error: "ripgrep (rg) is not installed or not on PATH. Install rg to enable grep_repo.",
        }),
      },
    );
    const result = JSON.parse(handleGrepRepo(access, "myrepo", { pattern: "x" })) as {
      error: string;
    };
    expect(result.error).toMatch(/ripgrep/i);
  });

  it("glob_files filters by extension and ignoreDirs", async () => {
    const fs = makeFakeFs({
      glob: vi.fn().mockResolvedValue(["src/a.ts", "src/b.js", "node_modules/x.ts"]),
      stat: vi.fn().mockResolvedValue({ size: 100, isDirectory: () => false }),
    });
    // shouldIncludeFile also rejects ignoreDirs in path segments
    const access = createRepoAccess({ myrepo: REPO }, { fs, grep: vi.fn() });
    const result = JSON.parse(await handleGlobFiles(access, "myrepo", { pattern: "**/*" })) as {
      files: string[];
    };
    expect(result.files).toEqual(["src/a.ts"]);
  });

  it("read_file returns content for a safe relative path", async () => {
    const fs = makeFakeFs({
      readFile: vi.fn().mockResolvedValue("hello"),
      stat: vi.fn().mockResolvedValue({ size: 5, isDirectory: () => false }),
    });
    const access = createRepoAccess({ myrepo: REPO }, { fs, grep: vi.fn() });
    const result = JSON.parse(await handleReadFile(access, "myrepo", { path: "src/a.ts" })) as {
      content: string;
      path: string;
    };
    expect(result).toEqual({ path: "src/a.ts", content: "hello" });
  });

  it("read_file rejects oversized files", async () => {
    const fs = makeFakeFs({
      stat: vi.fn().mockResolvedValue({ size: 100_000, isDirectory: () => false }),
    });
    const access = createRepoAccess({ myrepo: REPO }, { fs, grep: vi.fn() });
    const result = JSON.parse(await handleReadFile(access, "myrepo", { path: "big.ts" })) as {
      error: string;
    };
    expect(result.error).toMatch(/size limit/i);
  });

  it("returns a clear error when the agent has no repo config", () => {
    const access = createRepoAccess({}, { fs: makeFakeFs(), grep: vi.fn() });
    const result = JSON.parse(handleGrepRepo(access, "missing", { pattern: "x" })) as {
      error: string;
    };
    expect(result.error).toMatch(/No repo path configured/i);
  });
});
