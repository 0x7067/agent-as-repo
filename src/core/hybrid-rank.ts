/** RRF over ranked ID lists: score(id) = Σ 1 / (k + rank_i), rank is 1-based. */
export function rrfFuse(
  lists: ReadonlyArray<ReadonlyArray<string>>,
  k = 60,
): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    for (const [index, id] of list.entries()) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    }
  }
  // Map preserves insertion order, so the stable sort keeps equal scores in
  // first-appearance order across the input lists.
  const fused = [...scores.entries()].map(([id, score]) => ({ id, score }));
  fused.sort((a, b) => b.score - a.score);
  return fused;
}

/**
 * Convert a free-text query into a safe FTS5 MATCH expression.
 * Extract [A-Za-z0-9_]+ terms, wrap each in double quotes, join with OR.
 * Returns undefined when no terms survive (query was all punctuation) —
 * caller skips the lexical leg entirely. Quoting every term is the injection
 * guard: no FTS5 operator syntax from the query ever reaches MATCH unquoted.
 */
export function toFtsMatchQuery(query: string): string | undefined {
  const terms = query.match(/\w+/g);
  if (terms === null) return undefined;
  return terms.map((term) => `"${term}"`).join(" OR ");
}
