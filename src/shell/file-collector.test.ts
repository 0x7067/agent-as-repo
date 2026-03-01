import { describe, it, expect } from "vitest";
import { collectFiles } from "./file-collector.js";
import * as fs from "node:fs/promises";
import path from "node:path";
import * as os from "node:os";
import type { RepoConfig } from "../core/types.js";
import type { FileSystemPort } from "../ports/filesystem.js";

async function withTempRepo(
  files: Record<string, string>,
  fn: (repoPath: string) => Promise<void>,
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "repo-test-"));
  for (const [filePath, content] of Object.entries(files)) {
    const full = path.join(dir, filePath);
    await fs.mkdir(path.dirname(full), { recursive: true });
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
    tags: [],
    maxFileSizeKb: 50,
    memoryBlockLimit: 5000,
    bootstrapOnCreate: true,
    ...overrides,
  };
}

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
      readFile: async () => "mock content",
      writeFile: async () => {},
      stat: async () => ({ size: 100, isDirectory: () => false }),
      access: async () => {},
      rename: async () => {},
      copyFile: async () => {},
      glob: async () => ["src/mock.ts"],
    };

    const files = await collectFiles(makeConfig("/fake/path"), mockFs);
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

  it("includes files exactly at maxFileSizeKb limit", async () => {
    // 1 byte = ~0.001 KB; we want a file exactly at boundary
    const mockFs: FileSystemPort = {
      readFile: async () => "content",
      writeFile: async () => {},
      // File size exactly at maxFileSizeKb (50 KB)
      stat: async () => ({ size: 50 * 1024, isDirectory: () => false }),
      access: async () => {},
      rename: async () => {},
      copyFile: async () => {},
      glob: async () => ["src/boundary.ts"],
    };

    const config = makeConfig("/fake/path", { maxFileSizeKb: 50 });
    const files = await collectFiles(config, mockFs);
    // sizeKb === maxFileSizeKb (50 <= 50) → should be included
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/boundary.ts");
  });

  it("excludes files just above maxFileSizeKb limit", async () => {
    const mockFs: FileSystemPort = {
      readFile: async () => "content",
      writeFile: async () => {},
      // File size just over 50 KB
      stat: async () => ({ size: 50 * 1024 + 1, isDirectory: () => false }),
      access: async () => {},
      rename: async () => {},
      copyFile: async () => {},
      glob: async () => ["src/too-big.ts"],
    };

    const config = makeConfig("/fake/path", { maxFileSizeKb: 50 });
    const files = await collectFiles(config, mockFs);
    // sizeKb > maxFileSizeKb → should be excluded
    expect(files).toHaveLength(0);
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
