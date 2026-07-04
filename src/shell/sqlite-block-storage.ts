import type { BlockStorage } from "./block-storage.js";
import { openVectorDatabase, type VectorDatabase } from "./sqlite-native.js";

/**
 * Memory-block storage in the same sqlite DB as the passage store (one
 * machine-local substrate). BlockStorage is synchronous, which matches
 * better-sqlite3 exactly; a separate WAL-mode connection keeps this
 * independent of the passage store's lifecycle.
 */
export class SqliteBlockStorage implements BlockStorage {
  private readonly db: VectorDatabase;

  constructor(dbPath: string) {
    this.db = openVectorDatabase(dbPath);
    this.db.exec(`
CREATE TABLE IF NOT EXISTS blocks (
  agent_id TEXT NOT NULL,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (agent_id, label)
);
`);
  }

  close(): void {
    this.db.close();
  }

  get(agentId: string, label: string): string {
    const row = this.db
      .prepare("SELECT value FROM blocks WHERE agent_id = ? AND label = ?")
      .get(agentId, label) as { value: string } | undefined;
    return row?.value ?? "";
  }

  set(agentId: string, label: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO blocks (agent_id, label, value) VALUES (?, ?, ?) ON CONFLICT(agent_id, label) DO UPDATE SET value = excluded.value",
      )
      .run(agentId, label, value);
  }

  init(agentId: string, blocks: Record<string, string>): void {
    const write = this.db.transaction(() => {
      for (const [label, value] of Object.entries(blocks)) {
        this.set(agentId, label, value);
      }
    });
    write();
  }

  delete(agentId: string): void {
    this.db.prepare("DELETE FROM blocks WHERE agent_id = ?").run(agentId);
  }
}
