import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type BetterSqlite3 from "better-sqlite3";

export type VectorDatabase = BetterSqlite3.Database;

/**
 * Open a SQLite database with the sqlite-vec (vec0) extension loaded.
 * Native modules cannot live inside a JS bundle, so resolution goes through
 * createRequire; SEA builds swap in extracted asset paths at this boundary.
 */
export function openVectorDatabase(dbPath: string): VectorDatabase {
  if (dbPath !== ":memory:") {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is the app-owned store location
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const nativeRequire = createRequire(import.meta.url);
  const Database = nativeRequire("better-sqlite3") as typeof BetterSqlite3;
  const sqliteVec = nativeRequire("sqlite-vec") as { getLoadablePath: () => string };

  const db = new Database(dbPath);
  db.loadExtension(sqliteVec.getLoadablePath());
  db.pragma("journal_mode = WAL");
  return db;
}
