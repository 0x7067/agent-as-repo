import { buildSymbolIndex, findDefinitions, toSymbolLocation, type FindDefinitionsOptions, type SymbolIndex, type SymbolLocation } from "./symbol-index.js";
import { buildSymbolGraph } from "./symbol-graph.js";
import { pageRank } from "./symbol-pagerank.js";
import type { SymbolRef } from "./symbol-refs.js";
import type { SymbolKind, SymbolSpan } from "./tree-sitter-symbols.js";

/** Compact definition stored per file (filePath is the map key). */
export interface StoredSymbolDef {
  kind: SymbolKind;
  name: string;
  qualifiedName: string;
  className?: string;
  startIndex: number;
  endIndex: number;
  startLine: number;
  endLine: number;
}

/** Per-file defs + refs persisted on AgentState. */
export interface StoredSymbolFile {
  symbols: StoredSymbolDef[];
  refs: SymbolRef[];
}

/** Map of file path → stored symbol payload. */
export type SymbolFileMap = Record<string, StoredSymbolFile>;

/** Map of graph node id → PageRank score. */
export type SymbolRankMap = Record<string, number>;

export function toStoredSymbolFile(
  filePath: string,
  content: string,
  spans: readonly SymbolSpan[],
  refs: readonly SymbolRef[],
): StoredSymbolFile {
  const symbols: StoredSymbolDef[] = spans.map((span) => {
    const loc = toSymbolLocation(filePath, content, span);
    return {
      kind: loc.kind,
      name: loc.name,
      qualifiedName: loc.qualifiedName,
      ...(loc.className === undefined ? {} : { className: loc.className }),
      startIndex: loc.startIndex,
      endIndex: loc.endIndex,
      startLine: loc.startLine,
      endLine: loc.endLine,
    };
  });
  return { symbols, refs: [...refs] };
}

export function buildSymbolIndexFromStored(symbolFiles: SymbolFileMap): SymbolIndex {
  const symbols: SymbolLocation[] = [];
  for (const [filePath, file] of Object.entries(symbolFiles)) {
    for (const def of file.symbols) {
      symbols.push({
        filePath,
        kind: def.kind,
        name: def.name,
        qualifiedName: def.qualifiedName,
        ...(def.className === undefined ? {} : { className: def.className }),
        startIndex: def.startIndex,
        endIndex: def.endIndex,
        startLine: def.startLine,
        endLine: def.endLine,
      });
    }
  }
  return { symbols };
}

/** Recompute PageRank scores from persisted symbol files. */
export function computeSymbolRanks(symbolFiles: SymbolFileMap): SymbolRankMap {
  const index = buildSymbolIndexFromStored(symbolFiles);
  const files = Object.entries(symbolFiles).map(([filePath, data]) => ({
    filePath,
    refs: data.refs,
  }));
  if (index.symbols.length === 0 && files.every((f) => f.refs.length === 0)) {
    return {};
  }
  const graph = buildSymbolGraph({ index, files });
  return pageRank(graph);
}

export interface RankedSymbolHit extends SymbolLocation {
  rank: number;
}

/**
 * Look up definitions by name and sort by PageRank (desc) when ranks are available.
 * Pure — used by the CLI find_symbol tool handler.
 */
export function findRankedSymbols(
  index: SymbolIndex,
  name: string,
  ranks: SymbolRankMap | undefined,
  options: FindDefinitionsOptions = {},
): RankedSymbolHit[] {
  const hits = findDefinitions(index, name, options);
  const withRank: RankedSymbolHit[] = hits.map((hit) => {
    const nodeId = `def:${hit.filePath}#${hit.qualifiedName}@${String(hit.startLine)}`;
    const rank = ranks?.[nodeId] ?? 0;
    return { ...hit, rank };
  });
  // eslint-disable-next-line unicorn/no-array-sort -- Array#toSorted requires ES2023
  return withRank.sort(
    (a, b) => b.rank - a.rank || a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine,
  );
}

/** Convenience: build index from spans the same way as buildSymbolIndex (re-export path). */
export function indexFromSpans(
  files: ReadonlyArray<{ filePath: string; content: string; spans: readonly SymbolSpan[] }>,
): SymbolIndex {
  return buildSymbolIndex(files);
}
