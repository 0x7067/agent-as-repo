import { describe, it, expect } from "vitest";
import { collectFiles } from "./file-collector.js";
import * as fs from "node:fs/promises";
import path from "node:path";
import * as os from "node:os";
import type { RepoConfig } from "../core/types.js";
import type { FileSystemPort } from "../ports/filesystem.js";
import { nodeFileSystem } from "./adapters/node-filesystem.js";

async function withTempRepo(
  files: Record<string, string>,
  fn: (repoPath: string) => Promise<void>,
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "repo-test-"));
  for (const [filePath, content] of Object.entries(files)) {
    const full = path.join(dir, filePath);
    // Path is constrained under the mkdtemp-created test directory.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.mkdir(path.dirname(full), { recursive: true });
    // Path is constrained under the mkdtemp-created test directory.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.writeFile(full, content, "utf8");
  }
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
}

function makeConfig(repoPath: string, overrides?: Partial<RepoConfig>): RepoConfig {
  return {
    path: repoPath,
    description: "test repo",
    extensions: [".ts", ".js"],
    ignoreDirs: ["node_modules", ".git"],
    ...overrides,
  };
}

const FAKE_REPO_PATH = "/fake/path";

describe("collectFiles", () => {
  it("collects files matching extensions", async () => {
    await withTempRepo(
      {
        "src/index.ts": "export const x = 1;",
        "src/utils.js": "module.exports = {};",
        "readme.md": "# Hello",
      },
      async (repoPath) => {
        const files = await collectFiles(makeConfig(repoPath));
        const paths = files.map((f) => f.path);
        expect(paths).toContain("src/index.ts");
        expect(paths).toContain("src/utils.js");
        expect(paths).not.toContain("readme.md");
      },
    );
  });

  it("ignores files in ignored directories", async () => {
    await withTempRepo(
      {
        "src/app.ts": "const app = true;",
        "node_modules/pkg/index.ts": "nope",
      },
      async (repoPath) => {
        const files = await collectFiles(makeConfig(repoPath));
        const paths = files.map((f) => f.path);
        expect(paths).toContain("src/app.ts");
        expect(paths).not.toContain("node_modules/pkg/index.ts");
      },
    );
  });

  it("reads file content", async () => {
    await withTempRepo(
      { "src/hello.ts": "console.log('hi');" },
      async (repoPath) => {
        const files = await collectFiles(makeConfig(repoPath));
        expect(files[0].content).toBe("console.log('hi');");
      },
    );
  });

  it("returns relative paths", async () => {
    await withTempRepo(
      { "src/deep/nested/file.ts": "x" },
      async (repoPath) => {
        const files = await collectFiles(makeConfig(repoPath));
        expect(files[0].path).toBe("src/deep/nested/file.ts");
      },
    );
  });

  it("scopes collection to basePath for monorepos", async () => {
    await withTempRepo(
      {
        "packages/frontend/src/app.ts": "const app = true;",
        "packages/backend/src/server.ts": "const server = true;",
        "root.ts": "const root = true;",
      },
      async (repoPath) => {
        const files = await collectFiles(makeConfig(repoPath, { basePath: "packages/frontend" }));
        const paths = files.map((f) => f.path);
        expect(paths).toContain("src/app.ts");
        expect(paths).not.toContain("packages/backend/src/server.ts");
        expect(paths).not.toContain("root.ts");
      },
    );
  });

  it("collects submodule files with repo-root-relative paths when includeSubmodules is true", async () => {
    await withTempRepo(
      {
        "src/root.ts": "export const root = true;",
        "libs/my-lib/src/index.ts": "export const lib = true;",
        "libs/my-lib/src/util.ts": "export const util = true;",
      },
      async (repoPath) => {
        // Simulate an initialized submodule: create .git file (pointer)
        const subGitFile = path.join(repoPath, "libs/my-lib/.git");
        // Path is constrained under the mkdtemp-created test directory.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await fs.writeFile(subGitFile, "gitdir: ../../.git/modules/my-lib");

        const files = await collectFiles(makeConfig(repoPath, { includeSubmodules: true }));
        const paths = files.map((f) => f.path);

        expect(paths).toContain("src/root.ts");
        expect(paths).toContain("libs/my-lib/src/index.ts");
        expect(paths).toContain("libs/my-lib/src/util.ts");
      },
    );
  });

  it("does not traverse hidden .git dirs inside submodule paths when includeSubmodules is true", async () => {
    await withTempRepo(
      {
        "libs/my-lib/src/index.ts": "export const lib = true;",
      },
      async (repoPath) => {
        const files = await collectFiles(makeConfig(repoPath, { includeSubmodules: true }));
        const paths = files.map((f) => f.path);
        expect(paths.some((p) => p.includes(".git"))).toBe(false);
      },
    );
  });

  it("accepts injected FileSystemPort", async () => {
    const mockFs: FileSystemPort = {
      readFile: () => Promise.resolve("mock content"),
      writeFile: () => Promise.resolve(),
      stat: () => Promise.resolve({ size: 100, isDirectory: () => false }),
      access: () => Promise.resolve(),
      rename: () => Promise.resolve(),
      copyFile: () => Promise.resolve(),
      glob: () => Promise.resolve(["src/mock.ts"]),
    };

    const files = await collectFiles(makeConfig(FAKE_REPO_PATH), mockFs);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/mock.ts");
    expect(files[0].content).toBe("mock content");
  });

  it("excludes dotfiles (dot:false) from collection", async () => {
    await withTempRepo(
      {
        "src/index.ts": "export const x = 1;",
        ".hidden/secret.ts": "hidden content",
      },
      async (repoPath) => {
        const files = await collectFiles(makeConfig(repoPath));
        const paths = files.map((f) => f.path);
        expect(paths).toContain("src/index.ts");
        // dotfiles/hidden dirs should be excluded (dot: false)
        expect(paths.some((p) => p.startsWith(".hidden"))).toBe(false);
      },
    );
  });

  it("includes files exactly at the hard size cap (MAX_INDEXABLE_FILE_SIZE_KB)", async () => {
    const mockFs: FileSystemPort = {
      readFile: () => Promise.resolve("content"),
      writeFile: () => Promise.resolve(),
      // File size exactly at MAX_INDEXABLE_FILE_SIZE_KB (1024 KB)
      stat: () => Promise.resolve({ size: 1024 * 1024, isDirectory: () => false }),
      access: () => Promise.resolve(),
      rename: () => Promise.resolve(),
      copyFile: () => Promise.resolve(),
      glob: () => Promise.resolve(["src/boundary.ts"]),
    };

    const config = makeConfig(FAKE_REPO_PATH);
    const files = await collectFiles(config, mockFs);
    // sizeKb === cap (1024 <= 1024) → should be included
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/boundary.ts");
  });

  it("excludes files just above the hard size cap and reports them via onSkip", async () => {
    const mockFs: FileSystemPort = {
      readFile: () => Promise.resolve("content"),
      writeFile: () => Promise.resolve(),
      // File size just over 1024 KB
      stat: () => Promise.resolve({ size: 1024 * 1024 + 1024, isDirectory: () => false }),
      access: () => Promise.resolve(),
      rename: () => Promise.resolve(),
      copyFile: () => Promise.resolve(),
      glob: () => Promise.resolve(["src/too-big.ts"]),
    };

    const config = makeConfig(FAKE_REPO_PATH);
    const skipped: { path: string; sizeKb: number }[] = [];
    const files = await collectFiles(config, mockFs, undefined, (skip) => skipped.push(skip));
    // sizeKb > cap → should be excluded from the indexable file list...
    expect(files).toHaveLength(0);
    // ...but still reported so callers can surface "N files skipped (size)".
    expect(skipped).toEqual([{ path: "src/too-big.ts", sizeKb: 1025 }]);
  });

  it("indexes a file well above the old 50 KB gate but under the new hard cap (regression: sinatra base.rb)", async () => {
    // The bug this guards against: a 67 KB file (like lib/sinatra/base.rb)
    // used to get silently excluded by a whole-file pre-gate at 50 KB, even
    // though chunking already splits files into ~2 KB pieces.
    const mockFs: FileSystemPort = {
      readFile: () => Promise.resolve("x".repeat(67 * 1024)),
      writeFile: () => Promise.resolve(),
      stat: () => Promise.resolve({ size: 67 * 1024, isDirectory: () => false }),
      access: () => Promise.resolve(),
      rename: () => Promise.resolve(),
      copyFile: () => Promise.resolve(),
      glob: () => Promise.resolve(["lib/sinatra/base.rb"]),
    };

    const config = makeConfig(FAKE_REPO_PATH, { extensions: [".rb"] });
    const skipped: { path: string; sizeKb: number }[] = [];
    const files = await collectFiles(config, mockFs, undefined, (skip) => skipped.push(skip));
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("lib/sinatra/base.rb");
    expect(skipped).toEqual([]);
  });

  it("skips a broken symlink instead of aborting collection for the whole repo", async () => {
    await withTempRepo(
      {
        "src/good.ts": "export const ok = true;",
      },
      async (repoPath) => {
        const brokenLinkPath = path.join(repoPath, "src/broken.ts");
        // Path is constrained under the mkdtemp-created test directory.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await fs.symlink(path.join(repoPath, "src/does-not-exist.ts"), brokenLinkPath);

        // fast-glob itself already drops entries it can't stat, so the broken
        // link never reaches the loop through the real glob() call. Force it
        // into the entry list — as another glob() implementation/options, or
        // a symlink going stale between the glob() and our own stat(), would
        // — to exercise the real fs.stat()/readFile() ELOOP-or-ENOENT failure
        // against the real broken symlink sitting on disk.
        const fsWithForcedBrokenEntry: FileSystemPort = {
          ...nodeFileSystem,
          glob: async (patterns, options) => {
            const entries = await nodeFileSystem.glob(patterns, options);
            return [...entries, "src/broken.ts"];
          },
        };

        const errors: Array<{ filePath: string; message: string }> = [];
        const files = await collectFiles(makeConfig(repoPath), fsWithForcedBrokenEntry, (filePath, error) => {
          errors.push({ filePath, message: error.message });
        });

        const paths = files.map((f) => f.path);
        expect(paths).toContain("src/good.ts");
        expect(paths).not.toContain("src/broken.ts");
        expect(errors).toHaveLength(1);
        expect(errors[0].filePath).toBe("src/broken.ts");
      },
    );
  });

  it("skips a permission-denied file instead of aborting collection for the whole repo", async () => {
    const mockFs: FileSystemPort = {
      readFile: (p: string) => {
        if (p.includes("secret.ts")) return Promise.reject(new Error("EACCES: permission denied"));
        return Promise.resolve("export const ok = true;");
      },
      writeFile: () => Promise.resolve(),
      stat: () => Promise.resolve({ size: 10, isDirectory: () => false }),
      access: () => Promise.resolve(),
      rename: () => Promise.resolve(),
      copyFile: () => Promise.resolve(),
      glob: () => Promise.resolve(["src/good.ts", "src/secret.ts"]),
    };

    const errors: Array<{ filePath: string; message: string }> = [];
    const files = await collectFiles(makeConfig(FAKE_REPO_PATH), mockFs, (filePath, error) => {
      errors.push({ filePath, message: error.message });
    });

    const paths = files.map((f) => f.path);
    expect(paths).toContain("src/good.ts");
    expect(paths).not.toContain("src/secret.ts");
    expect(errors).toEqual([{ filePath: "src/secret.ts", message: "EACCES: permission denied" }]);
  });

  it("meets collection performance budget on medium fixture repo", async () => {
    const fixtureFiles: Record<string, string> = {};
    for (let i = 0; i < 300; i++) {
      fixtureFiles[`src/module-${String(i)}.ts`] = `export const value${String(i)} = ${String(i)};\n`;
    }

    await withTempRepo(fixtureFiles, async (repoPath) => {
      const startedAt = Date.now();
      const files = await collectFiles(makeConfig(repoPath));
      const durationMs = Date.now() - startedAt;

      expect(files.length).toBe(300);
      expect(durationMs).toBeLessThan(5000);
    });
  });
});
