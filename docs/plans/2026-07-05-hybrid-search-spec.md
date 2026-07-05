# Hybrid Search Spec — BM25 + Vector with Reciprocal Rank Fusion

Date: 2026-07-05
Status: proposed
Depends on: embedded sqlite-vec store (landed; `src/shell/sqlite-store.ts`)

## Why

`semanticSearch` is pure cosine similarity over embeddings. The queries it
actually serves — the agent's `archival_memory_search` tool calls and the MCP
`agent_search_archival` tool — are dominated by exact-identifier lookups:
function names, error strings, config keys. Embedding search is weakest on
exactly those (rare tokens, out-of-vocabulary identifiers), and the default
embedding models are small local ones (`nomic-embed-text`), which are mediocre
on code. Classic BM25 is strongest there. Combining both legs with Reciprocal
Rank Fusion (RRF) is the standard fix and what comparable tools (e.g.
sunbeamdotpt/memory) ship.

Cost is low: better-sqlite3 compiles SQLite with FTS5 enabled, so this is
**zero new dependencies**, contained entirely behind the existing
`PassageStore` port, and the fusion math is a pure function that belongs in
`src/core/`.

Explicitly out of scope: adopting sunbeam/memory as an external store. Once
hybrid search exists natively, its retrieval advantage is gone and an adapter
would only add a Rust binary to supervise.

## Design

### Core (pure, no I/O) — `src/core/hybrid-rank.ts`

Two pure functions, colocated tests, no mocks:

```ts
/** RRF over ranked ID lists: score(id) = Σ 1 / (k + rank_i), rank is 1-based. */
export function rrfFuse(
  lists: ReadonlyArray<ReadonlyArray<string>>,
  k?: number, // default 60 (the standard constant from the RRF paper)
): Array<{ id: string; score: number }>;

/**
 * Convert a free-text query into a safe FTS5 MATCH expression.
 * Extract [A-Za-z0-9_]+ terms, wrap each in double quotes, join with OR.
 * Returns undefined when no terms survive (query was all punctuation) —
 * caller skips the lexical leg entirely.
 */
export function toFtsMatchQuery(query: string): string | undefined;
```

Rules:

- `rrfFuse` output is sorted by fused score descending; ties break by order of
  first appearance across the input lists (deterministic — required for stable
  tests and reproducible agent behavior).
- An ID present in only one list still scores (that is the point of RRF); an
  ID in both lists outranks single-list IDs at comparable ranks.
- Quoting each term (rather than passing the raw query) is the injection
  guard: FTS5 MATCH has operator syntax (`NEAR`, `*`, `^`, parens, unquoted
  `-`) that throws on malformed input. Nothing from the user/LLM reaches
  MATCH unquoted.
- OR (not AND) semantics: agent queries are often long natural-language
  sentences; requiring every term to match would return nothing. BM25 ranking
  already rewards multi-term hits.

### Shell — `src/shell/sqlite-store.ts`

**Schema addition** (appended to `SCHEMA`, applied via existing
`CREATE ... IF NOT EXISTS` idempotency):

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS passage_fts USING fts5(
  text,
  content='passages',
  content_rowid='seq',
  tokenize="unicode61 tokenchars '_'"
);
CREATE TRIGGER IF NOT EXISTS passages_ai AFTER INSERT ON passages BEGIN
  INSERT INTO passage_fts(rowid, text) VALUES (new.seq, new.text);
END;
CREATE TRIGGER IF NOT EXISTS passages_ad AFTER DELETE ON passages BEGIN
  INSERT INTO passage_fts(passage_fts, rowid, text) VALUES ('delete', old.seq, old.text);
END;
```

Decisions baked in:

- **External-content FTS** (`content='passages'`): no duplicated text on disk;
  the FTS table stores only the inverted index.
- **Triggers, not manual upkeep**: every current write path
  (`writePassage` delete+insert, `deletePassage`, `deleteAgent`) already runs
  inside a transaction on `passages`; triggers make the index correct for all
  of them and for any future write path, with no per-callsite code. No UPDATE
  trigger — `writePassage` never UPDATEs, it deletes and re-inserts (and the
  architecture test / this spec's contract tests would catch a regression).
- **`tokenchars '_'`**: keeps `snake_case` identifiers whole. camelCase is a
  single token under unicode61 already. No stemming (porter) — stemming hurts
  code identifiers.

**Migration/backfill** for existing DBs (constructor, after `exec(SCHEMA)`):

```sql
-- if COUNT(passages) != COUNT(passage_fts): rebuild from content table
INSERT INTO passage_fts(passage_fts) VALUES ('rebuild');
```

One statement, idempotent, only runs when counts diverge. No `--reindex`, no
re-embedding, no state-file change: the FTS index derives entirely from text
already in `passages`.

**`semanticSearch` becomes hybrid** (same signature — no port change, so
`local-provider.ts`, `admin-adapter.ts`, and the MCP server are untouched):

1. Vector leg (existing code): top `CANDIDATES` by cosine, where
   `CANDIDATES = Math.max(limit * 3, 15)` — over-fetch so fusion has depth.
2. Lexical leg: `toFtsMatchQuery(query)`; if defined:
   ```sql
   SELECT rowid FROM passage_fts
   WHERE passage_fts MATCH ?
     AND rowid IN (SELECT seq FROM passages WHERE agent_id = ?)
   ORDER BY rank LIMIT ?  -- rank = BM25, ascending = best first
   ```
   If undefined (no extractable terms), skip — result is vector-only,
   identical to today.
3. Map both legs' rowids to passage `id`s, call `rrfFuse`, take top `limit`,
   hydrate `text` from `passages`.
4. `score` in `PassageSearchResult` becomes the RRF score (≈0.03 max for a
   two-list fusion at k=60). Consumers only rank/display it, but the JSDoc on
   `PassageSearchResult.score` must be updated to say "fused relevance score
   (higher is better); not cosine similarity". The `cosine_score` key emitted
   by `archival_memory_search` in `local-provider.ts` is renamed to `score`
   accordingly.

**Degradation:** if the FTS query throws despite sanitization, catch, log at
debug level, and return the vector-only ranking. Retrieval must never be
worse than today.

### Config

None. Hybrid is the only mode. A `search_mode` knob was considered and
rejected: the vector-only path remains reachable implicitly (queries with no
FTS terms) and keeping one code path is worth more than an escape hatch for a
strictly-additive ranking change. If real-world regressions surface, add the
knob then.

## TDD Plan (red → green, in order)

Phase 1 — core (no mocks):

1. `src/core/hybrid-rank.test.ts` / `rrfFuse`:
   - single list passes through in order with 1/(k+rank) scores
   - id in both lists outranks same-rank single-list ids
   - tie-break determinism (same input → same output order)
   - empty lists → empty result
2. `toFtsMatchQuery`:
   - plain words → `"where" OR "is" OR "reconcile"`
   - identifiers survive: `handleAuth`, `snake_case` (underscore kept whole)
   - FTS operator characters neutralized: `NEAR(a b)`, `"quoted"`, `foo*`,
     `-bar`, `(paren)` all produce only quoted bare terms
   - all-punctuation query → `undefined`

Phase 2 — shell (real temp-file DBs, per existing convention):

3. Extend `src/shell/passage-store.contract.test.ts`:
   - exact-identifier query returns the passage containing that identifier
     first, even when the stub embedder ranks it last (this is the test that
     proves the lexical leg exists — it fails on the current implementation)
   - agent scoping holds for the lexical leg (agent-a's terms never surface
     agent-b's passages)
   - query with no extractable terms still returns vector results
   - `writePassage` overwrite + `deletePassage` + `deleteAgent` leave no stale
     FTS rows (search for deleted text → no hits)
4. `src/shell/sqlite-store.test.ts` migration case: build a DB with the
   pre-FTS schema (create tables manually, insert passages), open it with
   `SqlitePassageStore`, assert lexical search finds the backfilled rows.

Phase 3 — consumer surface:

5. `local-provider.test.ts`: `archival_memory_search` result key rename
   (`cosine_score` → `score`).
6. Docs: `docs/architecture.md` archival-memory section gains a paragraph on
   hybrid retrieval; `PassageSearchResult.score` JSDoc updated.

## Acceptance Criteria

- `pnpm test` green; no mocks added to core tests; ESLint import rules pass
  (core imports nothing from shell — `hybrid-rank.ts` has zero imports).
- A query for an exact function name returns its passage first even when the
  embedding model ranks it outside the top `limit`.
- Opening a pre-existing `store.db` requires no user action and no
  re-embedding; lexical search works immediately after first open.
- Vector-only behavior is preserved verbatim when the query yields no FTS
  terms or the FTS leg errors.
- No new dependencies in `package.json`.

## Risks

- **FTS5 availability**: better-sqlite3's bundled SQLite enables FTS5 by
  default; guard anyway — if `CREATE VIRTUAL TABLE ... fts5` throws at
  startup, log once and run vector-only (same degradation path as a failed
  query).
- **Score semantics change**: RRF scores are small and unit-less where cosine
  was ~0–1. Only the LLM and MCP clients see them, and both consume rank, not
  magnitude — but the rename in `local-provider.ts` and JSDoc update are
  mandatory so nothing claims they're cosine.
- **Ranking regressions on fuzzy queries**: RRF can demote a strong vector
  hit if the lexical leg floods with weak keyword matches. Mitigated by
  over-fetching both legs (`CANDIDATES`) and k=60's flat curve; if it bites
  in practice, the future knob is `search_mode`, not a rewrite.
