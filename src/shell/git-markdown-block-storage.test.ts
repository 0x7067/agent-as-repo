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

describe("GitMarkdownBlockStorage", () => {
  it("persists blocks as markdown and round-trips get/set", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-mem-"));
    tempDirs.push(dir);
    const store = new GitMarkdownBlockStorage({ memoryDir: dir, sourceCommit: "abc" });
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
});
