import { describe, it, expect } from "vitest";
import { nodeFileSystem } from "./node-filesystem.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
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

describe("nodeFileSystem adapter", () => {
  it("satisfies FileSystemPort interface", () => {
    const adapter: FileSystemPort = nodeFileSystem;
    expect(adapter).toBeDefined();
  });

  it("readFile reads utf8 content", async () => {
    await withTmpDir(async (dir) => {
      const filePath = path.join(dir, "test.txt");
      await fs.writeFile(filePath, "hello world", "utf8");

      const content = await nodeFileSystem.readFile(filePath, "utf8");
      expect(content).toBe("hello world");
    });
  });

  it("writeFile creates a file with content", async () => {
    await withTmpDir(async (dir) => {
      const filePath = path.join(dir, "out.txt");
      await nodeFileSystem.writeFile(filePath, "written");

      const content = await fs.readFile(filePath, "utf8");
      expect(content).toBe("written");
    });
  });

  it("stat returns size and isDirectory", async () => {
    await withTmpDir(async (dir) => {
      const filePath = path.join(dir, "data.txt");
      await fs.writeFile(filePath, "abc", "utf8");

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
      await fs.writeFile(filePath, "", "utf8");

      await expect(nodeFileSystem.access(filePath)).resolves.toBeUndefined();
      await expect(nodeFileSystem.access(path.join(dir, "nope.txt"))).rejects.toThrow();
    });
  });

  it("rename moves a file", async () => {
    await withTmpDir(async (dir) => {
      const from = path.join(dir, "a.txt");
      const to = path.join(dir, "b.txt");
      await fs.writeFile(from, "data", "utf8");

      await nodeFileSystem.rename(from, to);

      await expect(fs.access(from)).rejects.toThrow();
      const content = await fs.readFile(to, "utf8");
      expect(content).toBe("data");
    });
  });

  it("copyFile copies a file", async () => {
    await withTmpDir(async (dir) => {
      const src = path.join(dir, "src.txt");
      const dest = path.join(dir, "dest.txt");
      await fs.writeFile(src, "copy me", "utf8");

      await nodeFileSystem.copyFile(src, dest);

      const content = await fs.readFile(dest, "utf8");
      expect(content).toBe("copy me");
      // Source still exists
      await expect(fs.access(src)).resolves.toBeUndefined();
    });
  });

  it("glob finds files matching patterns", async () => {
    await withTmpDir(async (dir) => {
      await fs.mkdir(path.join(dir, "src"), { recursive: true });
      await fs.writeFile(path.join(dir, "src/a.ts"), "x", "utf8");
      await fs.writeFile(path.join(dir, "src/b.js"), "y", "utf8");
      await fs.writeFile(path.join(dir, "readme.md"), "z", "utf8");

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
});
