import type { FindDefinitionsOptions } from "../core/symbol-index.js";
import {
  buildSymbolIndexFromStored,
  findRankedSymbols,
  type RankedSymbolHit,
} from "../core/symbol-store.js";
import type { AppState, SymbolFileMap, SymbolRankMap } from "../core/types.js";
import type { SymbolLookupPort } from "./agent-tools.js";

/**
 * Build a SymbolLookupPort from persisted agent state.
 * Looks up by agentId (which equals repoName for LocalProvider agents).
 */
export function createSymbolLookupFromState(state: AppState): SymbolLookupPort {
  return {
    find(agentId: string, name: string, options?: FindDefinitionsOptions): RankedSymbolHit[] {
      const agent =
        Object.values(state.agents).find((a) => a.agentId === agentId)
        ?? (Object.hasOwn(state.agents, agentId) ? state.agents[agentId] : undefined);
      if (agent === undefined) return [];
      const symbolFiles: SymbolFileMap = agent.symbolFiles ?? {};
      const ranks: SymbolRankMap | undefined = agent.symbolRanks;
      const index = buildSymbolIndexFromStored(symbolFiles);
      return findRankedSymbols(index, name, ranks, options);
    },
  };
}
