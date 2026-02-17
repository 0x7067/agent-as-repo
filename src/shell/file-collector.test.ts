import { describe, it, expect } from "vitest";
import { collectFiles } from "./file-collector.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { RepoConfig } from "../core/types.js";

async function withTempRepo(
  files: Record<string, string>,
  fn: (repoPath: string) => Promise<void>,
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "repo-test-"));
  for (const [filePath, content] of Object.entries(files)) {
    const full = path.join(dir, filePath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf-8");
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

  it("meets collection performance budget on medium fixture repo", async () => {
    const fixtureFiles: Record<string, string> = {};
    for (let i = 0; i < 300; i++) {
      fixtureFiles[`src/module-${i}.ts`] = `export const value${i} = ${i};\n`;
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
