import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import { parseGoldSet } from "../src/core/eval-metrics.js";

/**
 * Pure checks over the checked-in gold set: no DB, no network, no chunking
 * pipeline. Confirms the JSON parses against the schema, every gold file
 * actually exists in the mini-corpus fixture, the paraphrase/no-term buckets
 * are large enough to be statistically usable, and the no-term/paraphrase
 * bucket semantics (zero lexical-token overlap / no identifier leakage) hold.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLD_PATH = path.join(HERE, "retrieval-gold.json");
const FIXTURE_DIR = path.join(HERE, "fixtures", "mini-corpus");

const rawGold: unknown = JSON.parse(readFileSync(GOLD_PATH, "utf8"));
const gold = parseGoldSet(rawGold);

/**
 * The exact allowlist from the task's no-term bucket design: common English
 * function words that are allowed to overlap even though they may appear in
 * the gold file's text (they carry no lexical-retrieval signal).
 */
const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "for", "is", "are", "and", "or", "with",
  "on", "by", "as", "at", "be", "it", "this", "that", "from", "when", "how",
  "what", "into", "once", "was", "its",
]);

/** Same tokenization as src/core/hybrid-rank.ts toFtsMatchQuery: /\w+/g. */
function tokens(text: string): string[] {
  const matches = text.match(/\w+/g);
  return matches === null ? [] : matches.map((token) => token.toLowerCase());
}

const fixtureTextCache = new Map<string, string>();
function fixtureText(relativePath: string): string {
  const cached = fixtureTextCache.get(relativePath);
  if (cached !== undefined) return cached;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- paths come from the checked-in gold set, resolved under the fixture dir
  const text = readFileSync(path.join(FIXTURE_DIR, relativePath), "utf8");
  fixtureTextCache.set(relativePath, text);
  return text;
}

/** Identifier-ish tokens (camelCase or PascalCase) found in a file's text. */
function camelOrPascalIdentifiers(text: string): Set<string> {
  const candidates = text.match(/\b[a-z][a-z0-9]*\b/gi) ?? [];
  const identifiers = new Set<string>();
  for (const candidate of candidates) {
    // camelCase (lower, then an upper later) or PascalCase (leading upper
    // followed by a second upper somewhere, e.g. SettleOutstandingBalance) —
    // a plain capitalized English word like "Sole" doesn't qualify.
    const isCamel = /[a-z][A-Z]/.test(candidate);
    const isPascal = /^[A-Z][a-z]/.test(candidate) && /[a-z][A-Z]/.test(candidate);
    if (isCamel || isPascal) identifiers.add(candidate.toLowerCase());
  }
  return identifiers;
}

describe("retrieval-gold.json", () => {
  it("parses against the schema (parseGoldSet accepts it)", () => {
    expect(() => parseGoldSet(rawGold)).not.toThrow();
    expect(gold.queries.length).toBeGreaterThan(0);
  });

  it("every expect_files entry exists in eval/fixtures/mini-corpus", () => {
    for (const query of gold.queries) {
      for (const file of query.expect_files) {
        expect(() => fixtureText(file), `${query.id}: expect_files entry "${file}" missing from fixtures`).not.toThrow();
      }
    }
  });

  it("has no leftover punctuation-only no-term queries (covered by a sqlite-store unit test instead)", () => {
    const ids = gold.queries.map((q) => q.id);
    expect(ids).not.toContain("noterm-punct");
    expect(ids).not.toContain("noterm-symbols");
  });

  describe("bucket sizes", () => {
    const byKind = new Map<string, number>();
    for (const query of gold.queries) {
      byKind.set(query.kind, (byKind.get(query.kind) ?? 0) + 1);
    }

    it("has at least 15 paraphrase queries", () => {
      expect(byKind.get("paraphrase") ?? 0).toBeGreaterThanOrEqual(15);
    });

    it("has at least 15 no-term queries", () => {
      expect(byKind.get("no-term") ?? 0).toBeGreaterThanOrEqual(15);
    });
  });

  it("every query id is unique", () => {
    const ids = new Set<string>();
    for (const query of gold.queries) {
      expect(ids.has(query.id), `duplicate id ${query.id}`).toBe(false);
      ids.add(query.id);
    }
  });

  it("paraphrase ids start with para- and no-term ids with noterm-", () => {
    for (const query of gold.queries.filter((q) => q.kind === "paraphrase")) {
      expect(query.id.startsWith("para-"), `paraphrase id "${query.id}" should start with para-`).toBe(true);
    }
    for (const query of gold.queries.filter((q) => q.kind === "no-term")) {
      expect(query.id.startsWith("noterm-"), `no-term id "${query.id}" should start with noterm-`).toBe(true);
    }
  });

  describe("no-term queries have zero non-stopword token overlap with their gold files", () => {
    const noTermQueries = gold.queries.filter((q) => q.kind === "no-term");

    it("covers at least one no-term query to test against", () => {
      expect(noTermQueries.length).toBeGreaterThan(0);
    });

    for (const query of noTermQueries) {
      it(`${query.id}: "${query.query}"`, () => {
        const queryTokens = tokens(query.query).filter((token) => !STOPWORDS.has(token));
        for (const file of query.expect_files) {
          const fileTokens = new Set(tokens(fixtureText(file)));
          const overlap = queryTokens.filter((token) => fileTokens.has(token));
          expect(overlap, `${query.id} overlaps with ${file} on: ${overlap.join(", ")}`).toEqual([]);
        }
      });
    }
  });

  describe("paraphrase queries avoid leaking identifiers from their gold files", () => {
    const paraphraseQueries = gold.queries.filter((q) => q.kind === "paraphrase");

    it("covers at least one paraphrase query to test against", () => {
      expect(paraphraseQueries.length).toBeGreaterThan(0);
    });

    for (const query of paraphraseQueries) {
      it(`${query.id}: "${query.query}"`, () => {
        const queryTokens = tokens(query.query);

        const underscoreTokens = queryTokens.filter((token) => token.includes("_"));
        expect(underscoreTokens, `${query.id} contains snake_case-looking token(s): ${underscoreTokens.join(", ")}`).toEqual([]);

        for (const file of query.expect_files) {
          const identifiers = camelOrPascalIdentifiers(fixtureText(file));
          const leaked = queryTokens.filter((token) => identifiers.has(token));
          expect(leaked, `${query.id} leaks identifier(s) from ${file}: ${leaked.join(", ")}`).toEqual([]);
        }
      });
    }
  });
});
