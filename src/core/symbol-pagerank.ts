import type { SymbolGraph } from "./symbol-graph.js";

export interface PageRankOptions {
  /** Damping factor (probability of following an edge). Default 0.85. */
  damping?: number;
  /** Max iterations. Default 50. */
  maxIterations?: number;
  /** L1 convergence threshold. Default 1e-8. */
  tolerance?: number;
}

/**
 * Damped PageRank over a directed symbol graph.
 *
 * Edge direction follows dependency: importer/caller → definition.
 * Important symbols accumulate inbound rank from many dependents
 * (Aider repo-map lineage).
 *
 * Nodes with no outbound edges distribute their rank uniformly (dangling).
 * Returns a score map over all graph nodes (sums to ~1).
 */
export function pageRank(
  graph: SymbolGraph,
  options: PageRankOptions = {},
): Record<string, number> {
  const damping = options.damping ?? 0.85;
  const maxIterations = options.maxIterations ?? 50;
  const tolerance = options.tolerance ?? 1e-8;

  const nodes = graph.nodes;
  const n = nodes.length;
  if (n === 0) return {};

  const indexOf = new Map<string, number>();
  for (const [i, id] of nodes.entries()) indexOf.set(id, i);

  // Adjacency: from → list of to indices; also in-degree lists for iteration
  const outNeighbors: number[][] = Array.from({ length: n }, () => []);
  const outDegree = Array.from({ length: n }, () => 0);

  for (const edge of graph.edges) {
    const from = indexOf.get(edge.from);
    const to = indexOf.get(edge.to);
    if (from === undefined || to === undefined) continue;
    outNeighbors[from]!.push(to);
    outDegree[from]! += 1;
  }

  const teleport = (1 - damping) / n;
  let scores = Array.from({ length: n }, () => 1 / n);

  for (let iter = 0; iter < maxIterations; iter++) {
    const next = Array.from({ length: n }, () => teleport);
    let danglingMass = 0;

    for (let i = 0; i < n; i++) {
      if (outDegree[i] === 0) {
        danglingMass += scores[i]!;
      } else {
        const share = (damping * scores[i]!) / outDegree[i]!;
        for (const j of outNeighbors[i]!) {
          next[j]! += share;
        }
      }
    }

    // Dangling nodes: redistribute uniformly
    const danglingShare = (damping * danglingMass) / n;
    for (let i = 0; i < n; i++) {
      next[i]! += danglingShare;
    }

    let delta = 0;
    for (let i = 0; i < n; i++) {
      delta += Math.abs(next[i]! - scores[i]!);
    }
    scores = next;
    if (delta < tolerance) break;
  }

  const result: Record<string, number> = {};
  for (const [i, id] of nodes.entries()) {
    result[id] = scores[i]!;
  }
  return result;
}

/**
 * Rank definition nodes only, sorted descending by PageRank score.
 * File nodes (`file:…`) are omitted from the result list.
 */
export function rankDefinitions(
  graph: SymbolGraph,
  scores?: Record<string, number>,
): Array<{ nodeId: string; score: number }> {
  const ranks = scores ?? pageRank(graph);
  const defs: Array<{ nodeId: string; score: number }> = [];
  for (const [nodeId, score] of Object.entries(ranks)) {
    if (nodeId.startsWith("def:")) defs.push({ nodeId, score });
  }
  // eslint-disable-next-line unicorn/no-array-sort -- Array#toSorted requires ES2023
  return defs.sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId));
}
