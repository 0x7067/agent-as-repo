import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SqlitePassageStore, type EmbedTexts, type EmbedTask } from "./sqlite-store.js";
import { openVectorDatabase } from "./sqlite-native.js";
import { stubEmbed } from "./__test__/stub-embedder.js";

const MANIFEST = {
  agentId: "repo-a",
  name: "repo-expert-repo-a",
  model: "test-model",
  tags: [],
  createdAt: "2026-07-04T00:00:00.000Z",
};

function constantEmbed(dimension: number): EmbedTexts {
  return (texts) =>
    Promise.resolve(texts.map((text) => {
      const vector = Array.from({ length: dimension }, () => 0);
      vector[Math.abs(text.length) % dimension] = 1;
      return vector;
    }));
}

function fakeVector(seed: number): number[] {
  const vector = Array.from({ length: 8 }, () => 0);
  vector[seed % 8] = 1;
  return vector;
}

function embedByIndex() {
  return vi.fn((texts: string[], _task: EmbedTask) => Promise.resolve(texts.map((_, i) => fakeVector(i))));
}

async function makeBatchStore(dir: string, name: string, embed: EmbedTexts): Promise<SqlitePassageStore> {
  const store = new SqlitePassageStore({ dbPath: path.join(dir, name), embed });
  await store.initAgent("repo-a", MANIFEST);
  return store;
}

interface MinimalStatement {
  run: (...args: unknown[]) => unknown;
}
interface MinimalDb {
  prepare: (sql: string) => MinimalStatement;
}

/** Counts actual DELETE *executions* against passage_vectors, not prepare()
 * calls — a single prepared statement can still be .run() once per row. */
function countVectorDeleteRuns(store: SqlitePassageStore): { count: () => number } {
  const dbHandle = (store as unknown as { db: MinimalDb }).db;
  const originalPrepare = dbHandle.prepare.bind(dbHandle);
  let calls = 0;
  vi.spyOn(dbHandle, "prepare").mockImplementation((sql: string) => {
    const statement = originalPrepare(sql);
    if (!sql.includes("DELETE FROM passage_vectors")) return statement;
    const originalRun = statement.run.bind(statement);
    return { run: (...args: unknown[]) => { calls++; return originalRun(...args); } };
  });
  return { count: () => calls };
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

  it("embeds passages as documents and the search query as a query", async () => {
    const embedSpy = embedByIndex();
    const taskStore = await makeBatchStore(dir, "task.db", embedSpy);
    await taskStore.writePassage("repo-a", "p-1", "some text");
    await taskStore.semanticSearch("repo-a", "some text", 5);

    const tasks = embedSpy.mock.calls.map((call) => call[1]);
    expect(tasks).toContain("document");
    expect(tasks).toContain("query");
    expect(tasks.at(-1)).toBe("query");
    taskStore.close();
  });

  describe("searchLegs (leg-isolated diagnostic)", () => {
    let legStore: SqlitePassageStore;

    beforeEach(async () => {
      legStore = new SqlitePassageStore({ dbPath: path.join(dir, "legs.db"), embed: stubEmbed });
      await legStore.initAgent("repo-a", MANIFEST);
      await legStore.writePassage("repo-a", "p-auth", "authentication login session token verification");
      await legStore.writePassage("repo-a", "p-db", "database schema migration table index");
      await legStore.writePassage("repo-a", "p-ui", "button component render layout style");
    });

    afterEach(() => {
      legStore.close();
    });

    it("fused leg ranking equals semanticSearch ranking (no drift)", async () => {
      const query = "authentication login session token verification";
      const { fused } = await legStore.searchLegs("repo-a", query, 3);
      const production = await legStore.semanticSearch("repo-a", query, 3);

      expect(fused.slice(0, 3).map((r) => r.id)).toEqual(production.map((r) => r.id));
    });

    it("returns the vector and lexical legs separately for a term query", async () => {
      const { vector, lexical } = await legStore.searchLegs("repo-a", "database schema", 5);

      expect(vector.length).toBeGreaterThan(0);
      expect(lexical.map((r) => r.id)).toContain("p-db");
    });

    it("leaves the lexical leg empty for a no-term (punctuation) query", async () => {
      const { vector, lexical } = await legStore.searchLegs("repo-a", "!!! ??? ---", 5);

      expect(lexical).toEqual([]);
      // Vector leg still answers a no-term query, matching semanticSearch.
      expect(vector.length).toBeGreaterThan(0);
    });
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

  it("scopes semanticSearch to a file_path prefix when pathPrefix is set", async () => {
    await store.initAgent("repo-a", MANIFEST);
    await store.writePassage("repo-a", "p-auth", "FILE: src/auth/login.ts\n\nauthentication login session");
    await store.writePassage("repo-a", "p-ui", "FILE: src/ui/button.ts\n\nauthentication login session");

    const results = await store.semanticSearch("repo-a", "authentication login session", 10, {
      pathPrefix: "src/auth",
    });

    expect(results.map((r) => r.id)).toEqual(["p-auth"]);
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

  it("deletes vectors via chunked IN clauses instead of one DELETE per row", async () => {
    await store.initAgent("repo-a", MANIFEST);
    await store.initAgent("repo-b", { ...MANIFEST, agentId: "repo-b" });
    // Establishes the vector table/dimension and vectorTableReady, and gives
    // repo-b a passage that must survive repo-a's deletion untouched.
    await store.writePassage("repo-b", "keep-1", "keep me");

    const seed = openVectorDatabase(dbPath);
    const insertPassageSql = "INSERT INTO passages (id, agent_id, text, created_at) VALUES (?, 'repo-a', ?, '2026-07-04T00:00:00.000Z')";
    const insertPassage = seed.prepare(insertPassageSql);
    const insertVector = seed.prepare("INSERT INTO passage_vectors (rowid, embedding) VALUES (?, ?)");
    const zeroVector = Buffer.from(new Float32Array(8).buffer);
    for (let i = 0; i < 1200; i++) { // spans multiple 500-row chunks
      const info = insertPassage.run(`p-${String(i)}`, `bulk passage ${String(i)}`);
      insertVector.run(BigInt(info.lastInsertRowid), zeroVector);
    }
    seed.close();

    const vectorDeletes = countVectorDeleteRuns(store);
    await store.deleteAgent("repo-a");
    // One IN-clause execution per 500-row chunk (3 for 1200 rows), never one per row.
    expect(vectorDeletes.count()).toBeLessThanOrEqual(3);

    const verify = openVectorDatabase(dbPath);
    const remaining = (sql: string): number => (verify.prepare(sql).get() as { count: number }).count;
    expect(remaining("SELECT COUNT(*) AS count FROM passages WHERE agent_id = 'repo-a'")).toBe(0);
    // Only repo-b's "keep-1" vector should remain.
    expect(remaining("SELECT COUNT(*) AS count FROM passage_vectors")).toBe(1);
    expect(await store.listAgents()).toEqual(["repo-b"]);
    verify.close();
  });

  describe("writePassages (batch write path)", () => {
    it("embeds all texts in a single embedTexts call, not one per chunk", async () => {
      const embedSpy = embedByIndex();
      const batchStore = await makeBatchStore(dir, "batch.db", embedSpy);
      const entries = Array.from({ length: 5 }, (_, i) => ({ passageId: `p-${String(i)}`, text: `t${String(i)}` }));

      await batchStore.writePassages("repo-a", entries);

      expect(embedSpy).toHaveBeenCalledTimes(1);
      expect(embedSpy.mock.calls[0][0]).toHaveLength(5);
      expect(embedSpy.mock.calls[0][1]).toBe("document");
      expect(await batchStore.listPassages("repo-a")).toHaveLength(5);
      batchStore.close();
    });

    it("splits large batches into multiple embedTexts calls of at most 32 texts each", async () => {
      const embedSpy = embedByIndex();
      const batchStore = await makeBatchStore(dir, "batch-large.db", embedSpy);
      const entries = Array.from({ length: 70 }, (_, i) => ({ passageId: `p-${String(i)}`, text: `t${String(i)}` }));

      await batchStore.writePassages("repo-a", entries);

      expect(embedSpy).toHaveBeenCalledTimes(3);
      expect(embedSpy.mock.calls[0][0]).toHaveLength(32);
      expect(embedSpy.mock.calls[1][0]).toHaveLength(32);
      expect(embedSpy.mock.calls[2][0]).toHaveLength(6);
      expect(await batchStore.listPassages("repo-a")).toHaveLength(70);
      batchStore.close();
    });

    it("leaves no partial rows for a batch whose embedTexts call fails", async () => {
      const embedSpy = vi.fn().mockRejectedValue(new Error("embed endpoint down"));
      const batchStore = await makeBatchStore(dir, "batch-fail.db", embedSpy);
      const entries = [{ passageId: "p-1", text: "one" }, { passageId: "p-2", text: "two" }];

      await expect(batchStore.writePassages("repo-a", entries)).rejects.toThrow("embed endpoint down");
      expect(await batchStore.listPassages("repo-a")).toEqual([]);
      batchStore.close();
    });

    it("commits earlier successful batches even when a later batch's embed fails", async () => {
      let call = 0;
      const embedSpy = vi.fn((texts: string[]) => {
        call++;
        if (call === 2) return Promise.reject(new Error("second batch embed failed"));
        return Promise.resolve(texts.map((_, i) => fakeVector(i)));
      });
      const batchStore = await makeBatchStore(dir, "batch-partial.db", embedSpy);
      const entries = Array.from({ length: 40 }, (_, i) => ({ passageId: `p-${String(i)}`, text: `t${String(i)}` }));

      await expect(batchStore.writePassages("repo-a", entries)).rejects.toThrow("second batch embed failed");
      // First batch (32 entries) committed; second batch (8 entries) never wrote rows.
      expect(await batchStore.listPassages("repo-a")).toHaveLength(32);
      batchStore.close();
    });

    it("parses FILE: headers and supports overwriting an existing passage id, same as writePassage", async () => {
      await store.initAgent("repo-a", MANIFEST);
      await store.writePassages("repo-a", [{ passageId: "p-1", text: "FILE: src/auth.ts\n\noriginal" }]);
      await store.writePassages("repo-a", [{ passageId: "p-1", text: "FILE: src/auth.ts\n\nupdated" }]);

      expect(await store.readPassage("repo-a", "p-1")).toBe("FILE: src/auth.ts\n\nupdated");
      const db = openVectorDatabase(dbPath);
      const rows = db.prepare("SELECT id, file_path FROM passages WHERE agent_id = 'repo-a'").all();
      expect(rows).toEqual([{ id: "p-1", file_path: "src/auth.ts" }]);
      db.close();
    });
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
