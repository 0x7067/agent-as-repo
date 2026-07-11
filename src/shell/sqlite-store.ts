/* eslint-disable max-lines -- passage store + hybrid search intentionally stay in one module. */
import { extractSourcePath } from "../core/chunker.js";
import { rrfFuse, toFtsMatchQuery } from "../core/hybrid-rank.js";
import type {
  AgentManifest,
  PassageSearchResult,
  PassageStore,
  PassageWriteEntry,
  SemanticSearchOptions,
  StoredPassage,
} from "../ports/passage-store.js";
import { openVectorDatabase, type VectorDatabase } from "./sqlite-native.js";

/** Retrieval task an embedding is computed for; lets asymmetric models (e.g.
 * nomic-embed) prefix documents and queries differently. */
export type EmbedTask = "document" | "query";

export type EmbedTexts = (texts: string[], task: EmbedTask) => Promise<number[][]>;

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

/**
 * Lexical leg of hybrid search: an external-content FTS5 index over
 * passages.text, kept in sync by triggers so every write path (including
 * writePassage's delete+insert) maintains it without per-callsite code.
 * tokenchars '_' keeps snake_case identifiers whole; no stemming (it hurts
 * code identifiers). The table is created before the triggers so a failed
 * FTS setup never leaves triggers that would break plain writes.
 */
const FTS_TABLE_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS passage_fts USING fts5(
  text,
  content='passages',
  content_rowid='seq',
  tokenize="unicode61 tokenchars '_'"
);
`;

const FTS_TRIGGERS_SQL = `
CREATE TRIGGER IF NOT EXISTS passages_ai AFTER INSERT ON passages BEGIN
  INSERT INTO passage_fts(rowid, text) VALUES (new.seq, new.text);
END;
CREATE TRIGGER IF NOT EXISTS passages_ad AFTER DELETE ON passages BEGIN
  INSERT INTO passage_fts(passage_fts, rowid, text) VALUES ('delete', old.seq, old.text);
END;
`;

const DIMENSION_META_KEY = "embedding_dimension";

/** Max rowids per `WHERE rowid IN (...)` statement in deleteAgent's vector cleanup. */
const DELETE_CHUNK_SIZE = 500;

/** Max texts per embedTexts call in writePassages' batch write path. */
const EMBED_BATCH_SIZE = 32;

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

/** Embedded PassageStore: better-sqlite3 + the sqlite-vec vec0 extension. */
export class SqlitePassageStore implements PassageStore {
  private readonly db: VectorDatabase;
  private readonly embedTexts: EmbedTexts;
  private vectorTableReady = false;
  private ftsReady = false;

  constructor(options: SqlitePassageStoreOptions) {
    this.db = openVectorDatabase(options.dbPath);
    this.embedTexts = options.embed;
    this.db.exec(SCHEMA);
    this.ftsReady = this.initFullTextIndex();
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
      if (this.vectorTableReady) {
        for (let i = 0; i < seqs.length; i += DELETE_CHUNK_SIZE) {
          const batch = seqs.slice(i, i + DELETE_CHUNK_SIZE);
          const placeholders = batch.map(() => "?").join(", ");
          const sql = `DELETE FROM passage_vectors WHERE rowid IN (${placeholders})`;
          this.db.prepare(sql).run(...batch.map(({ seq }) => BigInt(seq)));
        }
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
    await this.writeBatch(agentId, [{ passageId, text }]);
  }

  /**
   * Batch write path: embeds all entries in groups of EMBED_BATCH_SIZE (one
   * embedTexts HTTP round trip per group instead of one per entry), each
   * group committed atomically. Validation (embedding + dimension check)
   * happens entirely before the transaction opens, so a failing embed call
   * — or a dimension mismatch — leaves no partial rows for that group.
   */
  async writePassages(agentId: string, entries: PassageWriteEntry[]): Promise<void> {
    for (let i = 0; i < entries.length; i += EMBED_BATCH_SIZE) {
      await this.writeBatch(agentId, entries.slice(i, i + EMBED_BATCH_SIZE));
    }
  }

  private async writeBatch(agentId: string, batch: PassageWriteEntry[]): Promise<void> {
    if (batch.length === 0) return;

    const vectors = await this.embedTexts(batch.map((entry) => entry.text), "document");
    const rows = batch.map((entry, index) => {
      const vector = vectors.at(index);
      if (vector === undefined) {
        throw new Error("Embedding endpoint returned no vector for the passage text");
      }
      this.assertDimension(vector.length);
      return {
        passageId: entry.passageId,
        text: entry.text,
        encoded: encodeVector(normalizeVector(vector)),
        filePath: extractSourcePath(entry.text),
      };
    });

    const insertPassage = this.db.prepare(
      "INSERT INTO passages (id, agent_id, file_path, text, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    const insertVector = this.db.prepare("INSERT INTO passage_vectors (rowid, embedding) VALUES (?, ?)");
    const findExisting = this.db.prepare("SELECT seq FROM passages WHERE agent_id = ? AND id = ?");
    const deleteVector = this.db.prepare("DELETE FROM passage_vectors WHERE rowid = ?");
    const deletePassageRow = this.db.prepare("DELETE FROM passages WHERE seq = ?");

    const write = this.db.transaction(() => {
      for (const row of rows) {
        const existing = findExisting.get(agentId, row.passageId) as { seq: number | bigint } | undefined;
        if (existing !== undefined) {
          deleteVector.run(BigInt(existing.seq));
          deletePassageRow.run(existing.seq);
        }
        const info = insertPassage.run(row.passageId, agentId, row.filePath, row.text, new Date().toISOString());
        insertVector.run(BigInt(info.lastInsertRowid), row.encoded);
      }
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

  async semanticSearch(
    agentId: string,
    query: string,
    limit: number,
    options?: SemanticSearchOptions,
  ): Promise<PassageSearchResult[]> {
    // Production ranking is exactly the fused leg, truncated to the limit — so
    // the searchLegs diagnostic can never drift from what users actually see.
    const { fused } = await this.computeLegs(agentId, query, limit, options?.pathPrefix);
    return fused.slice(0, limit);
  }

  /**
   * Diagnostic (benchmark/tests only, not on the PassageStore port): the vector
   * leg, lexical leg, and their RRF fusion returned separately over the same
   * over-fetch `semanticSearch` uses, so the benchmark can quantify hybrid
   * uplift by scoring each leg against the gold set.
   */
  async searchLegs(
    agentId: string,
    query: string,
    limit: number,
  ): Promise<{
    vector: PassageSearchResult[];
    lexical: PassageSearchResult[];
    fused: PassageSearchResult[];
  }> {
    return this.computeLegs(agentId, query, limit);
  }

  private async computeLegs(
    agentId: string,
    query: string,
    limit: number,
    pathPrefix?: string,
  ): Promise<{
    vector: PassageSearchResult[];
    lexical: PassageSearchResult[];
    fused: PassageSearchResult[];
  }> {
    const empty = { vector: [], lexical: [], fused: [] };
    if (limit <= 0 || !this.vectorTableReady) return empty;
    const countSql =
      pathPrefix === undefined
        ? "SELECT COUNT(*) AS count FROM passages WHERE agent_id = ?"
        : "SELECT COUNT(*) AS count FROM passages WHERE agent_id = ? AND file_path LIKE ?";
    const countArgs =
      pathPrefix === undefined ? [agentId] : [agentId, `${pathPrefix}%`];
    const countRow = this.db.prepare(countSql).get(...countArgs) as { count: number };
    if (countRow.count === 0) return empty;

    const vectors = await this.embedTexts([query], "query");
    const vector = vectors.at(0);
    if (vector === undefined) {
      throw new Error("Embedding endpoint returned no vector for the search query");
    }
    this.assertDimension(vector.length);
    const encoded = encodeVector(normalizeVector(vector));

    // Over-fetch both legs so RRF has depth to fuse over.
    const candidates = Math.max(limit * 3, 15);
    const agentScopeSql =
      pathPrefix === undefined
        ? "SELECT seq FROM passages WHERE agent_id = ?"
        : "SELECT seq FROM passages WHERE agent_id = ? AND file_path LIKE ?";
    const agentScopeArgs =
      pathPrefix === undefined ? [agentId] : [agentId, `${pathPrefix}%`];
    const vectorHits = this.db
      .prepare(
        `SELECT rowid FROM passage_vectors WHERE embedding MATCH ? AND k = ? AND rowid IN (${agentScopeSql})`,
      )
      .all(encoded, candidates, ...agentScopeArgs) as Array<{ rowid: number | bigint }>;
    const lexicalRowids = this.lexicalSearch(agentId, query, candidates, pathPrefix);

    const readPassageRow = this.db.prepare("SELECT id, text FROM passages WHERE seq = ?");
    const textById = new Map<string, string>();
    const toIds = (rowids: Array<number | bigint>): string[] => {
      const ids: string[] = [];
      for (const rowid of rowids) {
        const row = readPassageRow.get(rowid) as { id: string; text: string } | undefined;
        if (row === undefined) continue;
        textById.set(row.id, row.text);
        ids.push(row.id);
      }
      return ids;
    };
    const vectorIds = toIds(vectorHits.map((hit) => hit.rowid));
    const lexicalIds = toIds(lexicalRowids);

    const toResults = (ranked: Array<{ id: string; score: number }>): PassageSearchResult[] =>
      ranked.map(({ id, score }) => ({ id, text: textById.get(id) ?? "", score }));

    return {
      vector: toResults(rrfFuse([vectorIds])),
      lexical: toResults(rrfFuse([lexicalIds])),
      fused: toResults(rrfFuse([vectorIds, lexicalIds])),
    };
  }

  /**
   * BM25 leg over the FTS5 index; any failure degrades to an empty list so
   * retrieval is never worse than vector-only.
   */
  private lexicalSearch(
    agentId: string,
    query: string,
    limit: number,
    pathPrefix?: string,
  ): Array<number | bigint> {
    if (!this.ftsReady) return [];
    const match = toFtsMatchQuery(query);
    if (match === undefined) return [];
    try {
      const scopeSql =
        pathPrefix === undefined
          ? "SELECT seq FROM passages WHERE agent_id = ?"
          : "SELECT seq FROM passages WHERE agent_id = ? AND file_path LIKE ?";
      const scopeArgs =
        pathPrefix === undefined ? [agentId] : [agentId, `${pathPrefix}%`];
      const rows = this.db
        .prepare(
          `SELECT rowid FROM passage_fts WHERE passage_fts MATCH ? AND rowid IN (${scopeSql}) ORDER BY rank LIMIT ?`,
        )
        .all(match, ...scopeArgs, limit) as Array<{ rowid: number | bigint }>;
      return rows.map((row) => row.rowid);
    } catch (error) {
      console.warn(`repo-expert: FTS query failed, falling back to vector-only search: ${String(error)}`);
      return [];
    }
  }

  /**
   * Create the FTS index, backfill it when a pre-FTS database is opened
   * (counts diverge → FTS5 'rebuild' re-derives the index from passages),
   * and only then install the sync triggers. Returns false — vector-only
   * mode — if any step fails (e.g. FTS5 missing or the table unusable).
   */
  private initFullTextIndex(): boolean {
    try {
      this.db.exec(FTS_TABLE_SQL);
      const passageCount = (
        this.db.prepare("SELECT COUNT(*) AS count FROM passages").get() as { count: number }
      ).count;
      const indexedCount = (
        this.db.prepare("SELECT COUNT(*) AS count FROM passage_fts_docsize").get() as { count: number }
      ).count;
      if (passageCount !== indexedCount) {
        this.db.prepare("INSERT INTO passage_fts(passage_fts) VALUES ('rebuild')").run();
      }
      this.db.exec(FTS_TRIGGERS_SQL);
      return true;
    } catch (error) {
      // Triggers referencing a broken FTS table would fail every write.
      this.db.exec("DROP TRIGGER IF EXISTS passages_ai; DROP TRIGGER IF EXISTS passages_ad;");
      console.warn(
        `repo-expert: full-text index unavailable, using vector-only search: ${String(error)}`,
      );
      return false;
    }
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
/* eslint-enable max-lines */
