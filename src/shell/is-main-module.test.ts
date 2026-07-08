/* eslint-disable security/detect-non-literal-fs-filename -- all paths are constrained to test-owned temp dirs created in this file */
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isMainModule } from "./is-main-module.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "repo-expert-is-main-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("isMainModule", () => {
  it("returns true when argv[1] is the module path itself", () => {
    const dir = makeTempDir();
    const script = path.join(dir, "cli.mjs");
    writeFileSync(script, "// entry\n");

    expect(isMainModule(pathToFileURL(script).href, script)).toBe(true);
  });

  it("returns true when argv[1] is an npm bin symlink to the module", () => {
    const dir = makeTempDir();
    const script = path.join(dir, "cli.mjs");
    writeFileSync(script, "// entry\n");
    const binLink = path.join(dir, "repo-expert");
    symlinkSync(script, binLink);

    expect(isMainModule(pathToFileURL(script).href, binLink)).toBe(true);
  });

  it("returns false when argv[1] is a different script", () => {
    const dir = makeTempDir();
    const script = path.join(dir, "cli.mjs");
    const other = path.join(dir, "other.mjs");
    writeFileSync(script, "// entry\n");
    writeFileSync(other, "// other\n");

    expect(isMainModule(pathToFileURL(script).href, other)).toBe(false);
  });

  it("returns false when argv[1] does not exist on disk", () => {
    const dir = makeTempDir();
    const script = path.join(dir, "cli.mjs");
    writeFileSync(script, "// entry\n");

    expect(isMainModule(pathToFileURL(script).href, path.join(dir, "missing.mjs"))).toBe(false);
  });
});
/* eslint-enable security/detect-non-literal-fs-filename */
