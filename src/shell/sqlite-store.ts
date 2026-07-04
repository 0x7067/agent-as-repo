import { extractSourcePath } from "../core/chunker.js";
import type {
  AgentManifest,
  PassageSearchResult,
  PassageStore,
  StoredPassage,
} from "../ports/passage-store.js";
import { openVectorDatabase, type VectorDatabase } from "./sqlite-native.js";

export type EmbedTexts = (texts: string[]) => Promise<number[][]>;

export interface SqlitePassageStoreOptions {
  /** SQLite file location (parent directories are created as needed). */
  dbPath: string;
  /** Embedding function; all vectors must share one dimension per DB. */
  embed: EmbedTexts;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY,
  manifest TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS passages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  file_path TEXT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (agent_id, id)
);
CREATE INDEX IF NOT EXISTS idx_passages_agent ON passages(agent_id);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const DIMENSION_META_KEY = "embedding_dimension";

function normalizeVector(vector: number[]): number[] {
  let sumOfSquares = 0;
  for (const component of vector) sumOfSquares += component * component;
  const norm = Math.sqrt(sumOfSquares);
  if (norm === 0) return vector;
  return vector.map((component) => component / norm);
}

function encodeVector(vector: number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer);
}

/**
 * L2 distance between unit vectors maps to cosine similarity:
 * cos(a, b) = 1 - d^2 / 2.
 */
function distanceToScore(distance: number): number {
  return 1 - (distance * distance) / 2;
}

/** Embedded PassageStore: better-sqlite3 + the sqlite-vec vec0 extension. */
export class SqlitePassageStore implements PassageStore {
  private readonly db: VectorDatabase;
  private readonly embedTexts: EmbedTexts;
  private vectorTableReady = false;

  constructor(options: SqlitePassageStoreOptions) {
    this.db = openVectorDatabase(options.dbPath);
    this.embedTexts = options.embed;
    this.db.exec(SCHEMA);
    const dimension = this.storedDimension();
    if (dimension !== undefined) {
      this.ensureVectorTable(dimension);
    }
  }

  close(): void {
    this.db.close();
  }

  initAgent(agentId: string, manifest: AgentManifest): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO agents (agent_id, manifest) VALUES (?, ?) ON CONFLICT(agent_id) DO UPDATE SET manifest = excluded.manifest",
      )
      .run(agentId, JSON.stringify(manifest));
    return Promise.resolve();
  }

  deleteAgent(agentId: string): Promise<void> {
    const wipe = this.db.transaction(() => {
      const seqs = this.db
        .prepare("SELECT seq FROM passages WHERE agent_id = ?")
        .all(agentId) as Array<{ seq: number | bigint }>;
      const deleteVector = this.db.prepare("DELETE FROM passage_vectors WHERE rowid = ?");
      for (const { seq } of seqs) {
        if (this.vectorTableReady) deleteVector.run(BigInt(seq));
      }
      this.db.prepare("DELETE FROM passages WHERE agent_id = ?").run(agentId);
      this.db.prepare("DELETE FROM agents WHERE agent_id = ?").run(agentId);
    });
    wipe();
    return Promise.resolve();
  }

  listAgents(): Promise<string[]> {
    const rows = this.db
      .prepare("SELECT agent_id FROM agents ORDER BY agent_id")
      .all() as Array<{ agent_id: string }>;
    return Promise.resolve(rows.map((row) => row.agent_id));
  }

  async writePassage(agentId: string, passageId: string, text: string): Promise<void> {
    const vectors = await this.embedTexts([text]);
    const vector = vectors.at(0);
    if (vector === undefined) {
      throw new Error("Embedding endpoint returned no vector for the passage text");
    }
    this.assertDimension(vector.length);
    const encoded = encodeVector(normalizeVector(vector));
    const filePath = extractSourcePath(text);

    const write = this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT seq FROM passages WHERE agent_id = ? AND id = ?")
        .get(agentId, passageId) as { seq: number | bigint } | undefined;
      if (existing !== undefined) {
        this.db.prepare("DELETE FROM passage_vectors WHERE rowid = ?").run(BigInt(existing.seq));
        this.db.prepare("DELETE FROM passages WHERE seq = ?").run(existing.seq);
      }
      const info = this.db
        .prepare(
          "INSERT INTO passages (id, agent_id, file_path, text, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(passageId, agentId, filePath, text, new Date().toISOString());
      this.db
        .prepare("INSERT INTO passage_vectors (rowid, embedding) VALUES (?, ?)")
        .run(BigInt(info.lastInsertRowid), encoded);
    });
    write();
  }

  readPassage(agentId: string, passageId: string): Promise<string> {
    const row = this.db
      .prepare("SELECT text FROM passages WHERE agent_id = ? AND id = ?")
      .get(agentId, passageId) as { text: string } | undefined;
    if (row === undefined) {
      return Promise.reject(new Error(`Passage "${passageId}" not found for agent "${agentId}"`));
    }
    return Promise.resolve(row.text);
  }

  deletePassage(agentId: string, passageId: string): Promise<void> {
    const remove = this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT seq FROM passages WHERE agent_id = ? AND id = ?")
        .get(agentId, passageId) as { seq: number | bigint } | undefined;
      if (existing === undefined) return;
      if (this.vectorTableReady) {
        this.db.prepare("DELETE FROM passage_vectors WHERE rowid = ?").run(BigInt(existing.seq));
      }
      this.db.prepare("DELETE FROM passages WHERE seq = ?").run(existing.seq);
    });
    remove();
    return Promise.resolve();
  }

  listPassages(agentId: string): Promise<StoredPassage[]> {
    const rows = this.db
      .prepare("SELECT id, text FROM passages WHERE agent_id = ? ORDER BY seq")
      .all(agentId) as Array<{ id: string; text: string }>;
    return Promise.resolve(rows.map((row) => ({ id: row.id, text: row.text })));
  }

  async semanticSearch(agentId: string, query: string, limit: number): Promise<PassageSearchResult[]> {
    if (limit <= 0 || !this.vectorTableReady) return [];
    const countRow = this.db
      .prepare("SELECT COUNT(*) AS count FROM passages WHERE agent_id = ?")
      .get(agentId) as { count: number };
    if (countRow.count === 0) return [];

    const vectors = await this.embedTexts([query]);
    const vector = vectors.at(0);
    if (vector === undefined) {
      throw new Error("Embedding endpoint returned no vector for the search query");
    }
    this.assertDimension(vector.length);
    const encoded = encodeVector(normalizeVector(vector));

    const hits = this.db
      .prepare(
        "SELECT rowid, distance FROM passage_vectors WHERE embedding MATCH ? AND k = ? AND rowid IN (SELECT seq FROM passages WHERE agent_id = ?)",
      )
      .all(encoded, limit, agentId) as Array<{ rowid: number | bigint; distance: number }>;

    const readPassageRow = this.db.prepare("SELECT id, text FROM passages WHERE seq = ?");
    const results: PassageSearchResult[] = [];
    for (const hit of hits) {
      const row = readPassageRow.get(hit.rowid) as { id: string; text: string } | undefined;
      if (row === undefined) continue;
      results.push({ id: row.id, text: row.text, score: distanceToScore(hit.distance) });
    }
    return results;
  }

  private storedDimension(): number | undefined {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(DIMENSION_META_KEY) as { value: string } | undefined;
    if (row === undefined) return undefined;
    return Number(row.value);
  }

  private ensureVectorTable(dimension: number): void {
    if (!Number.isSafeInteger(dimension) || dimension <= 0) {
      throw new Error(`Invalid embedding dimension: ${String(dimension)}`);
    }
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS passage_vectors USING vec0(embedding float[${String(dimension)}])`,
    );
    this.vectorTableReady = true;
  }

  private assertDimension(dimension: number): void {
    const stored = this.storedDimension();
    if (stored === undefined) {
      this.db
        .prepare("INSERT INTO meta (key, value) VALUES (?, ?)")
        .run(DIMENSION_META_KEY, String(dimension));
      this.ensureVectorTable(dimension);
      return;
    }
    if (stored !== dimension) {
      throw new Error(
        `Embedding dimension mismatch: the index was built with ${String(stored)}-dimensional vectors but the embedding model returned ${String(dimension)}. ` +
          `Restore the previous provider.embedding_model or re-index with "repo-expert setup --reindex".`,
      );
    }
    if (!this.vectorTableReady) this.ensureVectorTable(stored);
  }
}
