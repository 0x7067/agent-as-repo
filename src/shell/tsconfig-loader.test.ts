/* eslint-disable security/detect-non-literal-fs-filename -- paths are constrained to mkdtemp-owned dirs in this file */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPathAliasesFromRepo } from "./tsconfig-loader.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadPathAliasesFromRepo", () => {
  it("loads JSONC tsconfig with trailing commas", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsconfig-load-"));
    tempDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      `{
  // comment
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@app/*": ["src/app/*"],
    },
  },
}
`,
      "utf8",
    );
    const cfg = loadPathAliasesFromRepo(dir);
    expect(cfg).toEqual({
      baseUrl: ".",
      paths: [{ pattern: "@app/*", targets: ["src/app/*"] }],
    });
  });

  it("returns undefined and warns on invalid JSON", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsconfig-bad-"));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, "tsconfig.json"), "{ not json", "utf8");
    const onWarn = vi.fn();
    expect(loadPathAliasesFromRepo(dir, { onWarn })).toBeUndefined();
    expect(onWarn).toHaveBeenCalled();
  });

  it("returns undefined silently when no config exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsconfig-none-"));
    tempDirs.push(dir);
    const onWarn = vi.fn();
    expect(loadPathAliasesFromRepo(dir, { onWarn })).toBeUndefined();
    expect(onWarn).not.toHaveBeenCalled();
  });
});

/* eslint-enable security/detect-non-literal-fs-filename */
