import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, it, expect, vi, afterEach } from "vitest";
import { openVectorDatabase } from "./sqlite-native.js";

describe("openVectorDatabase", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("explicitly sets busy_timeout=5000 via pragma (not just relying on the driver default)", () => {
    dir = mkdtempSync(path.join(tmpdir(), "repo-expert-sqlite-native-"));
    const dbPath = path.join(dir, "store.db");
    const pragmaSpy = vi.spyOn(Database.prototype, "pragma");
    const db = openVectorDatabase(dbPath);
    try {
      const pragmaArgs = pragmaSpy.mock.calls.map(([arg]) => arg.replaceAll(/\s+/g, ""));
      expect(pragmaArgs.some((arg) => arg.includes("busy_timeout=5000"))).toBe(true);
    } finally {
      pragmaSpy.mockRestore();
      db.close();
    }
  });

  it("reports busy_timeout as 5000ms on an opened DB, alongside WAL journal mode", () => {
    dir = mkdtempSync(path.join(tmpdir(), "repo-expert-sqlite-native-"));
    const dbPath = path.join(dir, "store.db");
    const db = openVectorDatabase(dbPath);
    try {
      expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
      expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    } finally {
      db.close();
    }
  });

  it("supports an in-memory database without touching the filesystem", () => {
    const db = openVectorDatabase(":memory:");
    try {
      expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
    } finally {
      db.close();
    }
  });
});
