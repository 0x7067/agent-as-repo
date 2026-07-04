import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PassageStore } from "../ports/passage-store.js";
import { SqlitePassageStore } from "./sqlite-store.js";

/**
 * Contract tests: every PassageStore implementation must satisfy these.
 * The sqlite implementation runs against a real temp-file DB with a
 * deterministic fake embedder; new implementations join IMPLEMENTATIONS.
 */

const MANIFEST = {
  agentId: "repo-a",
  name: "repo-expert-repo-a",
  model: "test-model",
  tags: ["repo-expert"],
  createdAt: "2026-07-04T00:00:00.000Z",
};

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter(Boolean);
}

/** Deterministic bag-of-words embedding: same text → same unit vector. */
function fakeEmbed(texts: string[]): Promise<number[][]> {
  const vectors = texts.map((text) => {
    const vector = Array.from({ length: 64 }, () => 0);
    for (const word of tokenize(text)) {
      let hash = 0;
      for (const ch of word) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
      const slot = hash % vector.length;
      vector[slot] = (vector[slot] ?? 0) + 1;
    }
    const norm = Math.hypot(...vector) || 1;
    return vector.map((component) => component / norm);
  });
  return Promise.resolve(vectors);
}

interface StoreContext {
  store: PassageStore;
  cleanup: () => void;
}

const IMPLEMENTATIONS: Array<{ name: string; create: () => StoreContext }> = [
  {
    name: "SqlitePassageStore",
    create: () => {
      const dir = mkdtempSync(path.join(tmpdir(), "repo-expert-store-"));
      const store = new SqlitePassageStore({
        dbPath: path.join(dir, "store.db"),
        embed: fakeEmbed,
      });
      return {
        store,
        cleanup: () => {
          store.close();
          rmSync(dir, { recursive: true, force: true });
        },
      };
    },
  },
];

describe.each(IMPLEMENTATIONS)("PassageStore contract: $name", ({ create }) => {
  let context: StoreContext;
  let store: PassageStore;

  beforeEach(() => {
    context = create();
    store = context.store;
  });

  afterEach(() => {
    context.cleanup();
  });

  it("initAgent makes the agent visible in listAgents", async () => {
    await store.initAgent("repo-a", MANIFEST);

    const agents = await store.listAgents();

    expect(agents).toContain("repo-a");
  });

  it("deleteAgent removes the agent and its passages", async () => {
    await store.initAgent("repo-a", MANIFEST);
    await store.writePassage("repo-a", "p-1", "some text");

    await store.deleteAgent("repo-a");

    expect(await store.listAgents()).not.toContain("repo-a");
    expect(await store.listPassages("repo-a")).toEqual([]);
  });

  it("writePassage/readPassage round-trips text", async () => {
    await store.initAgent("repo-a", MANIFEST);

    await store.writePassage("repo-a", "p-1", "FILE: src/auth.ts\n\nlogin logic");

    expect(await store.readPassage("repo-a", "p-1")).toBe("FILE: src/auth.ts\n\nlogin logic");
  });

  it("readPassage throws for a missing passage", async () => {
    await store.initAgent("repo-a", MANIFEST);

    await expect(store.readPassage("repo-a", "missing")).rejects.toThrow();
  });

  it("writePassage with an existing id replaces the text", async () => {
    await store.initAgent("repo-a", MANIFEST);
    await store.writePassage("repo-a", "p-1", "old text");

    await store.writePassage("repo-a", "p-1", "new text");

    expect(await store.readPassage("repo-a", "p-1")).toBe("new text");
    const passages = await store.listPassages("repo-a");
    expect(passages).toEqual([{ id: "p-1", text: "new text" }]);
  });

  it("deletePassage removes the passage and is idempotent", async () => {
    await store.initAgent("repo-a", MANIFEST);
    await store.writePassage("repo-a", "p-1", "some text");

    await store.deletePassage("repo-a", "p-1");
    await store.deletePassage("repo-a", "p-1");

    expect(await store.listPassages("repo-a")).toEqual([]);
  });

  it("listPassages returns every stored passage with id and text", async () => {
    await store.initAgent("repo-a", MANIFEST);
    await store.writePassage("repo-a", "p-1", "first passage");
    await store.writePassage("repo-a", "p-2", "second passage");

    const passages = await store.listPassages("repo-a");

    expect(passages).toHaveLength(2);
    expect(new Map(passages.map((p) => [p.id, p.text]))).toEqual(
      new Map([
        ["p-1", "first passage"],
        ["p-2", "second passage"],
      ]),
    );
  });

  it("listPassages returns [] for an agent without passages", async () => {
    await store.initAgent("repo-a", MANIFEST);

    expect(await store.listPassages("repo-a")).toEqual([]);
  });

  it("semanticSearch ranks the best-matching passage first and respects the limit", async () => {
    await store.initAgent("repo-a", MANIFEST);
    await store.writePassage("repo-a", "p-auth", "authentication login session token verification");
    await store.writePassage("repo-a", "p-db", "database schema migration table index");
    await store.writePassage("repo-a", "p-ui", "button component render layout style");

    const results = await store.semanticSearch(
      "repo-a",
      "authentication login session token verification",
      2,
    );

    expect(results.length).toBeLessThanOrEqual(2);
    expect(results[0]).toMatchObject({ id: "p-auth" });
    for (const result of results) {
      expect(typeof result.id).toBe("string");
      expect(typeof result.text).toBe("string");
      expect(typeof result.score).toBe("number");
    }
  });

  it("semanticSearch returns [] for an agent without passages", async () => {
    await store.initAgent("repo-a", MANIFEST);

    expect(await store.semanticSearch("repo-a", "anything", 5)).toEqual([]);
  });
});
