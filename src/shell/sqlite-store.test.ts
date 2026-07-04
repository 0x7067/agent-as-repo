import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqlitePassageStore } from "./sqlite-store.js";
import { openVectorDatabase } from "./sqlite-native.js";

const MANIFEST = {
  agentId: "repo-a",
  name: "repo-expert-repo-a",
  model: "test-model",
  tags: [],
  createdAt: "2026-07-04T00:00:00.000Z",
};

function constantEmbed(dimension: number): (texts: string[]) => Promise<number[][]> {
  return (texts) =>
    Promise.resolve(texts.map((text) => {
      const vector = Array.from({ length: dimension }, () => 0);
      vector[Math.abs(text.length) % dimension] = 1;
      return vector;
    }));
}

describe("SqlitePassageStore", () => {
  let dir: string;
  let dbPath: string;
  let store: SqlitePassageStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "repo-expert-sqlite-"));
    dbPath = path.join(dir, "store.db");
    store = new SqlitePassageStore({ dbPath, embed: constantEmbed(8) });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists passages across store instances on the same DB file", async () => {
    await store.initAgent("repo-a", MANIFEST);
    await store.writePassage("repo-a", "p-1", "persistent text");
    store.close();

    store = new SqlitePassageStore({ dbPath, embed: constantEmbed(8) });

    expect(await store.readPassage("repo-a", "p-1")).toBe("persistent text");
    expect(await store.listAgents()).toContain("repo-a");
    const results = await store.semanticSearch("repo-a", "persistent text", 5);
    expect(results[0]).toMatchObject({ id: "p-1" });
  });

  it("records the source file path parsed from the FILE: chunk header", async () => {
    await store.initAgent("repo-a", MANIFEST);
    await store.writePassage("repo-a", "p-1", "FILE: src/auth.ts\n\nlogin logic");
    await store.writePassage("repo-a", "p-2", "no header here");

    const db = openVectorDatabase(dbPath);
    try {
      const rows = db
        .prepare("SELECT id, file_path FROM passages ORDER BY id")
        .all() as Array<{ id: string; file_path: string | null }>;
      expect(rows).toEqual([
        { id: "p-1", file_path: "src/auth.ts" },
        { id: "p-2", file_path: null },
      ]);
    } finally {
      db.close();
    }
  });

  it("scopes semanticSearch to the requested agent", async () => {
    await store.initAgent("repo-a", MANIFEST);
    await store.initAgent("repo-b", { ...MANIFEST, agentId: "repo-b" });
    // identical text → identical embedding for both agents
    await store.writePassage("repo-a", "p-a", "shared text");
    await store.writePassage("repo-b", "p-b", "shared text");

    const results = await store.semanticSearch("repo-a", "shared text", 10);

    expect(results.map((r) => r.id)).toEqual(["p-a"]);
  });

  it("rejects embeddings whose dimension no longer matches the stored index", async () => {
    await store.initAgent("repo-a", MANIFEST);
    await store.writePassage("repo-a", "p-1", "eight dims");
    store.close();

    store = new SqlitePassageStore({ dbPath, embed: constantEmbed(16) });

    await expect(store.writePassage("repo-a", "p-2", "sixteen dims")).rejects.toThrow(
      /dimension/i,
    );
  });

  it("creates the parent directory for the DB file when missing", async () => {
    const nestedPath = path.join(dir, "deep", "nested", "store.db");

    const nested = new SqlitePassageStore({ dbPath: nestedPath, embed: constantEmbed(8) });
    try {
      await nested.initAgent("repo-a", MANIFEST);
      expect(await nested.listAgents()).toEqual(["repo-a"]);
    } finally {
      nested.close();
    }
  });
});
