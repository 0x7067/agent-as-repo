import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicWriteFileSync } from "./atomic-fs.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "atomic-fs-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("atomicWriteFileSync", () => {
  it("writes the target file with the given content", () => {
    const dir = makeTempDir();
    const targetPath = path.join(dir, "asset.bin");

    atomicWriteFileSync(targetPath, "hello world");

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp dir under test
    expect(readFileSync(targetPath, "utf8")).toBe("hello world");
  });

  it("leaves no temp file behind in the target directory", () => {
    const dir = makeTempDir();
    const targetPath = path.join(dir, "asset.bin");

    atomicWriteFileSync(targetPath, "hello world");

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp dir under test
    expect(readdirSync(dir)).toEqual(["asset.bin"]);
  });

  it("atomically replaces an existing (e.g. truncated/corrupt) file rather than appending or partially overwriting", () => {
    const dir = makeTempDir();
    const targetPath = path.join(dir, "asset.bin");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp dir under test
    writeFileSync(targetPath, "TRUNCATED-OLD-CONTENT-THAT-IS-LONGER-THAN-THE-NEW-CONTENT");

    atomicWriteFileSync(targetPath, "new");

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp dir under test
    expect(readFileSync(targetPath, "utf8")).toBe("new");
  });

  it("supports Buffer content", () => {
    const dir = makeTempDir();
    const targetPath = path.join(dir, "asset.bin");

    atomicWriteFileSync(targetPath, Buffer.from([1, 2, 3, 4]));

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp dir under test
    expect(existsSync(targetPath)).toBe(true);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a fixture built from the temp dir under test
    expect(readFileSync(targetPath)).toEqual(Buffer.from([1, 2, 3, 4]));
  });
});
