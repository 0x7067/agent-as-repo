import { describe, it, expect, vi } from "vitest";
import { nodeFileSystem } from "./node-filesystem.js";
import * as fs from "node:fs/promises";
import path from "node:path";
import * as os from "node:os";
import type { FileSystemPort } from "../../ports/filesystem.js";

async function withTmpDir(fn: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "node-fs-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
}

async function writeTmpFile(filePath: string, content: string): Promise<void> {
  // Path is constrained under the mkdtemp-created temp directory used in each test.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.writeFile(filePath, content, "utf8");
}

async function readTmpFile(filePath: string): Promise<string> {
  // Path is constrained under the mkdtemp-created temp directory used in each test.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.readFile(filePath, "utf8");
}

async function mkdirTmpDirectory(directoryPath: string): Promise<void> {
  // Path is constrained under the mkdtemp-created temp directory used in each test.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.mkdir(directoryPath, { recursive: true });
}

describe("nodeFileSystem adapter", () => {
  it("satisfies FileSystemPort interface", () => {
    const adapter: FileSystemPort = nodeFileSystem;
    expect(adapter).toBeDefined();
  });

  it("readFile reads utf8 content", async () => {
    await withTmpDir(async (dir) => {
      const filePath = path.join(dir, "test.txt");
      await writeTmpFile(filePath, "hello world");

      const content = await nodeFileSystem.readFile(filePath, "utf8");
      expect(content).toBe("hello world");
    });
  });

  it("writeFile creates a file with content", async () => {
    await withTmpDir(async (dir) => {
      const filePath = path.join(dir, "out.txt");
      await nodeFileSystem.writeFile(filePath, "written");

      const content = await readTmpFile(filePath);
      expect(content).toBe("written");
    });
  });

  it("stat returns size and isDirectory", async () => {
    await withTmpDir(async (dir) => {
      const filePath = path.join(dir, "data.txt");
      await writeTmpFile(filePath, "abc");

      const fileStat = await nodeFileSystem.stat(filePath);
      expect(fileStat.size).toBe(3);
      expect(fileStat.isDirectory()).toBe(false);

      const dirStat = await nodeFileSystem.stat(dir);
      expect(dirStat.isDirectory()).toBe(true);
    });
  });

  it("access resolves for existing file and rejects for missing", async () => {
    await withTmpDir(async (dir) => {
      const filePath = path.join(dir, "exists.txt");
      await writeTmpFile(filePath, "");

      await expect(nodeFileSystem.access(filePath)).resolves.toBeUndefined();
      await expect(nodeFileSystem.access(path.join(dir, "nope.txt"))).rejects.toThrow();
    });
  });

  it("rename moves a file", async () => {
    await withTmpDir(async (dir) => {
      const from = path.join(dir, "a.txt");
      const to = path.join(dir, "b.txt");
      await writeTmpFile(from, "data");

      await nodeFileSystem.rename(from, to);

      await expect(fs.access(from)).rejects.toThrow();
      const content = await readTmpFile(to);
      expect(content).toBe("data");
    });
  });

  it("copyFile copies a file", async () => {
    await withTmpDir(async (dir) => {
      const src = path.join(dir, "src.txt");
      const dest = path.join(dir, "dest.txt");
      await writeTmpFile(src, "copy me");

      await nodeFileSystem.copyFile(src, dest);

      const content = await readTmpFile(dest);
      expect(content).toBe("copy me");
      // Source still exists
      await expect(fs.access(src)).resolves.toBeUndefined();
    });
  });

  it("writeFile stores multibyte utf8 content correctly", async () => {
    await withTmpDir(async (dir) => {
      const filePath = path.join(dir, "utf8.txt");
      const content = "こんにちは世界 \u2603"; // Japanese + snowman (multibyte chars)
      await nodeFileSystem.writeFile(filePath, content);

      // Read back as utf8 to verify encoding was applied correctly
      const read = await readTmpFile(filePath);
      expect(read).toBe(content);
    });
  });

  it("glob finds files matching patterns", async () => {
    await withTmpDir(async (dir) => {
      await mkdirTmpDirectory(path.join(dir, "src"));
      await writeTmpFile(path.join(dir, "src/a.ts"), "x");
      await writeTmpFile(path.join(dir, "src/b.js"), "y");
      await writeTmpFile(path.join(dir, "readme.md"), "z");

      const results = await nodeFileSystem.glob(["**/*.ts"], {
        cwd: dir,
        absolute: false,
        dot: false,
      });

      expect(results).toContain("src/a.ts");
      expect(results).not.toContain("src/b.js");
      expect(results).not.toContain("readme.md");
    });
  });

  it("glob respects onlyFiles option via fast-glob", async () => {
    await withTmpDir(async (dir) => {
      await mkdirTmpDirectory(path.join(dir, "sub"));
      await writeTmpFile(path.join(dir, "sub/file.ts"), "x");

      const results = await nodeFileSystem.glob(["**/*"], {
        cwd: dir,
        onlyFiles: true,
        followSymbolicLinks: false,
      });

      expect(results).toContain("sub/file.ts");
      expect(results.every((r) => !r.endsWith("sub"))).toBe(true);
    });
  });

  it("watch calls fs.watch and returns a handle with close and on", () => {
    const handle = nodeFileSystem.watch(os.tmpdir(), { recursive: true }, vi.fn());
    expect(typeof handle.close).toBe("function");
    expect(typeof handle.on).toBe("function");
    handle.close();
  });
});
