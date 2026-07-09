/* eslint-disable security/detect-non-literal-fs-filename -- paths are constrained to mkdtemp-owned dirs in this file */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GitMarkdownBlockStorage } from "./git-markdown-block-storage.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeStore(sourceCommit?: string): { dir: string; store: GitMarkdownBlockStorage } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-mem-"));
  tempDirs.push(dir);
  return {
    dir,
    store: new GitMarkdownBlockStorage({
      memoryDir: dir,
      ...(sourceCommit === undefined ? {} : { sourceCommit }),
    }),
  };
}

describe("GitMarkdownBlockStorage", () => {
  it("persists blocks as markdown and round-trips get/set", () => {
    const { dir, store } = makeStore("abc");
    store.init("myrepo", {
      persona: "I am an expert.",
      architecture: "Uses sqlite.",
      conventions: "pnpm only.",
    });
    expect(store.get("myrepo", "architecture")).toBe("Uses sqlite.");
    const file = fs.readFileSync(path.join(dir, "myrepo", "architecture.md"), "utf8");
    expect(file).toContain("source_commit: abc");
    expect(file).toContain("Uses sqlite.");

    store.set("myrepo", "architecture", "Updated arch.");
    expect(store.get("myrepo", "architecture")).toBe("Updated arch.");

    store.delete("myrepo");
    expect(store.get("myrepo", "architecture")).toBe("");
  });

  it("rejects path-traversal labels and agentIds", () => {
    const { dir, store } = makeStore();
    store.init("myrepo", { architecture: "safe" });

    expect(() => {
      store.set("myrepo", "../../outside", "evil");
    }).toThrow(/separators|rejects|invalid/i);
    expect(() => {
      store.get("myrepo", "../x");
    }).toThrow(/separators|rejects|invalid/i);
    expect(() => {
      store.delete("../outside");
    }).toThrow(/separators|rejects|\.\./i);

    expect(fs.existsSync(path.join(dir, "myrepo", "architecture.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "outside.md"))).toBe(false);
  });

  it("updates sourceCommit for subsequent writes", () => {
    const { dir, store } = makeStore("old");
    store.set("myrepo", "architecture", "v1");
    store.setSourceCommit("newsha");
    store.set("myrepo", "architecture", "v2");
    const file = fs.readFileSync(path.join(dir, "myrepo", "architecture.md"), "utf8");
    expect(file).toContain("source_commit: newsha");
    expect(file).not.toContain("source_commit: old");
  });
});

/* eslint-enable security/detect-non-literal-fs-filename */
