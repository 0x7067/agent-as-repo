import { describe, expect, it } from "vitest";
import type { SymbolGraph } from "./symbol-graph.js";
import { pageRank, rankDefinitions } from "./symbol-pagerank.js";

function graph(nodes: string[], edges: SymbolGraph["edges"]): SymbolGraph {
  return { nodes, edges };
}

describe("pageRank", () => {
  it("returns empty map for empty graph", () => {
    expect(pageRank(graph([], []))).toEqual({});
  });

  it("gives equal scores to disconnected nodes", () => {
    const scores = pageRank(graph(["a", "b", "c"], []));
    expect(scores["a"]).toBeCloseTo(1 / 3, 5);
    expect(scores["b"]).toBeCloseTo(1 / 3, 5);
    expect(scores["c"]).toBeCloseTo(1 / 3, 5);
  });

  it("ranks a heavily referenced node higher", () => {
    // Many files point at hub; hub points nowhere (dangling)
    const nodes = ["file:a", "file:b", "file:c", "def:hub"];
    const edges: SymbolGraph["edges"] = [
      { from: "file:a", to: "def:hub", kind: "call" },
      { from: "file:b", to: "def:hub", kind: "call" },
      { from: "file:c", to: "def:hub", kind: "import" },
    ];
    const scores = pageRank(graph(nodes, edges));
    expect(scores["def:hub"]!).toBeGreaterThan(scores["file:a"]!);
    expect(scores["def:hub"]!).toBeGreaterThan(scores["file:b"]!);
  });

  it("scores sum to approximately 1", () => {
    const nodes = ["a", "b", "c"];
    const edges: SymbolGraph["edges"] = [
      { from: "a", to: "b", kind: "call" },
      { from: "b", to: "c", kind: "call" },
      { from: "c", to: "a", kind: "call" },
    ];
    const scores = pageRank(graph(nodes, edges));
    const sum = Object.values(scores).reduce((acc, v) => acc + v, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});

describe("rankDefinitions", () => {
  it("returns only def: nodes sorted by score descending", () => {
    const nodes = ["file:a", "def:x", "def:y"];
    const edges: SymbolGraph["edges"] = [
      { from: "file:a", to: "def:x", kind: "call" },
      { from: "file:a", to: "def:x", kind: "import" },
      { from: "def:y", to: "def:x", kind: "call" },
    ];
    const g = graph(nodes, edges);
    const ranked = rankDefinitions(g);
    expect(ranked.every((r) => r.nodeId.startsWith("def:"))).toBe(true);
    expect(ranked[0]?.nodeId).toBe("def:x");
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[1]!.score);
  });
});
