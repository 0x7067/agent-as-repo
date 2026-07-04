import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteBlockStorage } from "./sqlite-block-storage.js";

describe("SqliteBlockStorage", () => {
  let dir: string;
  let dbPath: string;
  let storage: SqliteBlockStorage;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "repo-expert-blocks-"));
    dbPath = path.join(dir, "store.db");
    storage = new SqliteBlockStorage(dbPath);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty string for a missing block", () => {
    expect(storage.get("myrepo", "persona")).toBe("");
  });

  it("round-trips set/get per agent and label", () => {
    storage.set("myrepo", "persona", "I am the persona");
    storage.set("myrepo", "architecture", "Arch");
    storage.set("other", "persona", "Other persona");

    expect(storage.get("myrepo", "persona")).toBe("I am the persona");
    expect(storage.get("myrepo", "architecture")).toBe("Arch");
    expect(storage.get("other", "persona")).toBe("Other persona");
  });

  it("overwrites an existing block value", () => {
    storage.set("myrepo", "persona", "old");
    storage.set("myrepo", "persona", "new");

    expect(storage.get("myrepo", "persona")).toBe("new");
  });

  it("init writes all provided blocks", () => {
    storage.init("myrepo", { persona: "p", architecture: "a", conventions: "c" });

    expect(storage.get("myrepo", "persona")).toBe("p");
    expect(storage.get("myrepo", "architecture")).toBe("a");
    expect(storage.get("myrepo", "conventions")).toBe("c");
  });

  it("delete removes only the agent's blocks", () => {
    storage.init("myrepo", { persona: "p" });
    storage.init("other", { persona: "q" });

    storage.delete("myrepo");

    expect(storage.get("myrepo", "persona")).toBe("");
    expect(storage.get("other", "persona")).toBe("q");
  });

  it("persists blocks across instances on the same DB file", () => {
    storage.set("myrepo", "persona", "durable");
    storage.close();

    storage = new SqliteBlockStorage(dbPath);

    expect(storage.get("myrepo", "persona")).toBe("durable");
  });
});
