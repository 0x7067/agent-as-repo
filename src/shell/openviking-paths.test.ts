import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveOpenVikingBlocksDir } from "./openviking-paths.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveOpenVikingBlocksDir", () => {
  it("uses OPENVIKING_BLOCKS_DIR when writable", () => {
    const cwd = makeTempDir("openviking-paths-");
    const blocksDir = path.join(cwd, "custom-blocks");

    const result = resolveOpenVikingBlocksDir({
      cwd,
      homeDir: "/dev/null",
      env: { OPENVIKING_BLOCKS_DIR: blocksDir },
    });

    expect(result).toBe(blocksDir);
  });

  it("falls back to project-local directory when env and home candidates are not writable", () => {
    const cwd = makeTempDir("openviking-paths-");
    const expected = path.join(cwd, ".openviking", "blocks");

    const result = resolveOpenVikingBlocksDir({
      cwd,
      homeDir: "/dev/null",
      env: { OPENVIKING_BLOCKS_DIR: "/dev/null/not-writable" },
    });

    expect(result).toBe(expected);
  });

  it("throws when all candidates are not writable", () => {
    expect(() =>
      resolveOpenVikingBlocksDir({
        cwd: "/dev/null",
        homeDir: "/dev/null",
        env: { OPENVIKING_BLOCKS_DIR: "/dev/null/not-writable" },
      }),
    ).toThrow("Unable to find a writable OpenViking block storage directory");
  });
});
