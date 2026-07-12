/**
 * RRF over ranked ID lists: score(id) = Σ weight_i / (k + rank_i), rank is
 * 1-based. `weights` defaults to 1 for every list (unweighted RRF); when
 * provided it must have one entry per list.
 */
export function rrfFuse(
  lists: ReadonlyArray<ReadonlyArray<string>>,
  k = 60,
  weights?: readonly number[],
): Array<{ id: string; score: number }> {
  if (weights !== undefined && weights.length !== lists.length) {
    throw new Error(
      `rrfFuse: weights length (${String(weights.length)}) must match lists length (${String(lists.length)})`,
    );
  }
  const scores = new Map<string, number>();
  for (const [listIndex, list] of lists.entries()) {
    const weight = weights?.[listIndex] ?? 1;
    for (const [index, id] of list.entries()) {
      scores.set(id, (scores.get(id) ?? 0) + weight / (k + index + 1));
    }
  }
  // Map preserves insertion order, so the stable sort keeps equal scores in
  // first-appearance order across the input lists.
  const fused = [...scores.entries()].map(([id, score]) => ({ id, score }));
  fused.sort((a, b) => b.score - a.score);
  return fused;
}

/**
 * Fused-leg RRF parameters, chosen from a 36-config offline sweep against
 * eval/retrieval-gold.json across the deterministic/transformersjs/http
 * engines. Unweighted k=60 lets a mediocre dual-leg co-occurrence bury a
 * clean single-leg vector rank-1 hit: at rank 20 in both legs, 1/80 + 1/80
 * (=1/40) beats a vector rank-1's 1/61. k=10 with vector weight 2 / lexical
 * weight 1 restores the single-leg signal. Larger vector weights or smaller
 * k were tried and rejected: they regress the identifier gate (deterministic)
 * and the config-key lexical rescue (http).
 */
export const FUSED_RRF_K = 10;
export const FUSED_VECTOR_WEIGHT = 2;
export const FUSED_LEXICAL_WEIGHT = 1;

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
