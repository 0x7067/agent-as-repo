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

  it("keeps the FTS index in sync through overwrite, delete, and deleteAgent", async () => {
    await store.initAgent("repo-a", MANIFEST);
    await store.initAgent("repo-b", { ...MANIFEST, agentId: "repo-b" });
    await store.writePassage("repo-a", "p-1", "the obsoleteAlphaToken text");
    await store.writePassage("repo-a", "p-2", "the betaToken text");
    await store.writePassage("repo-b", "p-3", "the gammaToken text");

    await store.writePassage("repo-a", "p-1", "the freshAlphaToken text");
    await store.deletePassage("repo-a", "p-2");
    await store.deleteAgent("repo-b");

    const db = openVectorDatabase(dbPath);
    try {
      const passageCount = db.prepare("SELECT COUNT(*) AS count FROM passages").get() as {
        count: number;
      };
      const ftsCount = db.prepare("SELECT COUNT(*) AS count FROM passage_fts_docsize").get() as {
        count: number;
      };
      expect(ftsCount.count).toBe(passageCount.count);

      const matches = (term: string): number =>
        (
          db
            .prepare("SELECT COUNT(*) AS count FROM passage_fts WHERE passage_fts MATCH ?")
            .get(`"${term}"`) as { count: number }
        ).count;
      expect(matches("obsoleteAlphaToken")).toBe(0);
      expect(matches("betaToken")).toBe(0);
      expect(matches("gammaToken")).toBe(0);
      expect(matches("freshAlphaToken")).toBe(1);
    } finally {
      db.close();
    }
  });

  it("backfills the FTS index when opening a pre-FTS database", async () => {
    store.close();
    rmSync(dbPath, { force: true });
    const legacy = openVectorDatabase(dbPath);
    legacy.exec(`
      CREATE TABLE agents (agent_id TEXT PRIMARY KEY, manifest TEXT NOT NULL);
      CREATE TABLE passages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        file_path TEXT,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (agent_id, id)
      );
      CREATE INDEX idx_passages_agent ON passages(agent_id);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE VIRTUAL TABLE passage_vectors USING vec0(embedding float[8]);
    `);
    legacy.prepare("INSERT INTO agents (agent_id, manifest) VALUES (?, ?)").run(
      "repo-a",
      JSON.stringify(MANIFEST),
    );
    legacy.prepare("INSERT INTO meta (key, value) VALUES ('embedding_dimension', '8')").run();
    const insertPassage = legacy.prepare(
      "INSERT INTO passages (id, agent_id, text, created_at) VALUES (?, 'repo-a', ?, '2026-07-04T00:00:00.000Z')",
    );
    const insertVector = legacy.prepare(
      "INSERT INTO passage_vectors (rowid, embedding) VALUES (?, ?)",
    );
    const texts: Array<[string, string]> = [
      ["p-legacy", "the legacy_marker_token passage"],
      ["p-other", "a plain unrelated passage"],
    ];
    for (const [id, text] of texts) {
      const info = insertPassage.run(id, text);
      const vector = new Float32Array(8);
      vector[text.length % 8] = 1;
      insertVector.run(BigInt(info.lastInsertRowid), Buffer.from(vector.buffer));
    }
    legacy.close();

    store = new SqlitePassageStore({ dbPath, embed: constantEmbed(8) });

    const results = await store.semanticSearch("repo-a", "legacy_marker_token", 5);
    expect(results[0]).toMatchObject({ id: "p-legacy" });
  });

  it("degrades to vector-only search when the FTS table is unusable", async () => {
    store.close();
    rmSync(dbPath, { force: true });
    const poisoned = openVectorDatabase(dbPath);
    // A plain table squatting on the FTS name: CREATE VIRTUAL TABLE IF NOT
    // EXISTS skips it, and every FTS operation against it fails.
    poisoned.exec("CREATE TABLE passage_fts (bogus TEXT)");
    poisoned.close();

    store = new SqlitePassageStore({ dbPath, embed: constantEmbed(8) });
    await store.initAgent("repo-a", MANIFEST);
    await store.writePassage("repo-a", "p-1", "still searchable text");

    const results = await store.semanticSearch("repo-a", "still searchable text", 5);
    expect(results[0]).toMatchObject({ id: "p-1" });
  });

  it("degrades to vector-only results when the FTS query fails at search time", async () => {
    await store.initAgent("repo-a", MANIFEST);
    await store.writePassage("repo-a", "p-1", "resilient passage text");

    const saboteur = openVectorDatabase(dbPath);
    saboteur.exec(
      "DROP TRIGGER passages_ai; DROP TRIGGER passages_ad; DROP TABLE passage_fts;",
    );
    saboteur.close();

    const results = await store.semanticSearch("repo-a", "resilient passage text", 5);
    expect(results[0]).toMatchObject({ id: "p-1" });
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
