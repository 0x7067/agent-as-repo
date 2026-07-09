import { definitionNodeId } from "./symbol-graph.js";
import type { SymbolFileMap, SymbolRankMap } from "./symbol-store.js";

export interface FormatTopSymbolsEvidenceOptions {
  maxEntries?: number;
  minScore?: number;
}

interface RankedDef {
  kind: string;
  name: string;
  filePath: string;
  score: number;
}

/**
 * Format top PageRank symbols as consolidation evidence (architecture/conventions).
 */
export function formatTopSymbolsEvidence(
  symbolFiles: SymbolFileMap | undefined,
  ranks: SymbolRankMap | undefined,
  options: FormatTopSymbolsEvidenceOptions = {},
): string {
  if (symbolFiles === undefined || ranks === undefined) return "";

  const maxEntries = options.maxEntries ?? 25;
  const minScore = options.minScore ?? 0;
  const ranked: RankedDef[] = [];

  for (const [filePath, file] of Object.entries(symbolFiles)) {
    for (const def of file.symbols) {
      const nodeId = definitionNodeId({
        filePath,
        qualifiedName: def.qualifiedName,
        startLine: def.startLine,
      });
      const score = ranks[nodeId] ?? 0;
      if (score < minScore) continue;
      ranked.push({ kind: def.kind, name: def.name, filePath, score });
    }
  }

  if (ranked.length === 0) return "";

  ranked.sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath) || a.name.localeCompare(b.name));
  const top = ranked.slice(0, maxEntries);

  const lines: string[] = ["High-centrality symbols (PageRank):"];
  for (const item of top) {
    lines.push(`- ${item.kind} ${item.name} @ ${item.filePath}`);
  }
  return lines.join("\n");
}
