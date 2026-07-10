import type { PassageStore } from "../ports/passage-store.js";
import type { RepoAccessPort } from "../ports/repo-access.js";
import { budgetSearchResults } from "../core/search-result-budget.js";
import type { FindDefinitionsOptions } from "../core/symbol-index.js";
import type { RankedSymbolHit } from "../core/symbol-store.js";
import type { SymbolKind } from "../core/tree-sitter-symbols.js";
import { BLOCK_LABELS, MEMORY_BLOCK_LIMIT } from "../core/types.js";
import type { ToolDefinition, ToolHandler } from "./llm-client.js";
import { handleGlobFiles, handleGrepRepo, handleReadFile } from "./repo-tools.js";

const MUTABLE_MEMORY_LABELS = new Set(["architecture", "conventions"]);
const DEFAULT_SEARCH_RESULTS = 5;
const MAX_SEARCH_RESULTS = 10;
const SEARCH_RESULT_TEXT_CHARS = 1200;
const MAX_RESULTS_PER_FILE = 2;

const GREP_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "grep_repo",
    description:
      "Regex search the live repository with ripgrep. Prefer this for exact identifiers, strings, and patterns.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex or fixed pattern to search for" },
        path: { type: "string", description: "Optional relative directory or file to scope the search" },
        glob: { type: "string", description: "Optional glob filter (e.g. *.ts)" },
        case_insensitive: { type: "boolean", description: "Case-insensitive search" },
        max_results: { type: "number", description: "Max matches per file (default 50)" },
      },
      required: ["pattern"],
    },
  },
};

const GLOB_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "glob_files",
    description: "List files in the live repository matching a glob pattern",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern (default **/*)" },
      },
      required: [],
    },
  },
};

const READ_FILE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "read_file",
    description: "Read a bounded line range from a live repository file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from the repo root" },
        start_line: { type: "number", description: "Optional one-based first line (default 1)" },
        end_line: { type: "number", description: "Optional one-based last line (default: 400 lines)" },
      },
      required: ["path"],
    },
  },
};

const FIND_SYMBOL_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "find_symbol",
    description:
      "Look up definition locations for a symbol by name (or Class.method). Results are ranked by repo-map importance when available. Prefer this over grep for known symbol names.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Bare symbol name or qualified name (e.g. SyncOrchestrator.run)",
        },
        kind: {
          type: "string",
          description: "Optional kind filter (FUNCTION, CLASS, METHOD, …)",
        },
        path_prefix: {
          type: "string",
          description: "Optional file path prefix to narrow results",
        },
        class_name: {
          type: "string",
          description: "Optional containing class/module name for methods",
        },
      },
      required: ["name"],
    },
  },
};

const ARCHIVAL_SEARCH_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "archival_memory_search",
    description:
      "Semantic + BM25 recall over indexed passages. Use for conceptual questions; optionally narrow with path_prefix.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        path_prefix: {
          type: "string",
          description: "Optional file_path prefix to stage-narrow results (e.g. src/auth)",
        },
        top_k: {
          type: "number",
          description: "Number of passages to return (default 5, maximum 10)",
        },
      },
      required: ["query"],
    },
  },
};

const MEMORY_REPLACE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "memory_replace",
    description: "Update a memory block with new content",
    parameters: {
      type: "object",
      properties: {
        label: {
          type: "string",
          enum: ["architecture", "conventions"],
          description: "Mutable block label",
        },
        value: { type: "string", description: "New block content" },
      },
      required: ["label", "value"],
    },
  },
};

function missingRepoAccessError(): string {
  return JSON.stringify({
    error:
      "Live repo access is not configured for this agent. Archival search still works; configure config.yaml repos to enable grep/glob/read.",
  });
}

function missingSymbolIndexError(): string {
  return JSON.stringify({
    error:
      "Symbol index is not available for this agent. Run setup/sync to build the repo map, or use grep_repo.",
  });
}

/** Port for looking up ranked symbol definitions (backed by AgentState.symbolFiles). */
export interface SymbolLookupPort {
  find(
    agentId: string,
    name: string,
    options?: FindDefinitionsOptions,
  ): RankedSymbolHit[];
}

export interface BuildAskToolsParams {
  agentId: string;
  agenticTools: boolean;
  repoAccess: RepoAccessPort | undefined;
  symbolLookup: SymbolLookupPort | undefined;
  store: PassageStore;
  updateBlock: (agentId: string, label: string, value: string) => Promise<unknown>;
}

const SYMBOL_KINDS = new Set<string>([
  "FUNCTION",
  "CLASS",
  "INTERFACE",
  "TYPE",
  "CONST",
  "METHOD",
  "ENUM",
  "MODULE",
  "STRUCT",
  "TRAIT",
]);

export function handleFindSymbol(
  lookup: SymbolLookupPort,
  agentId: string,
  args: Record<string, unknown>,
): string {
  const name = typeof args["name"] === "string" ? args["name"] : "";
  if (name.length === 0) {
    return JSON.stringify({ error: "name is required" });
  }

  const options: FindDefinitionsOptions = {};
  const kindRaw = args["kind"];
  if (typeof kindRaw === "string" && SYMBOL_KINDS.has(kindRaw)) {
    options.kind = kindRaw as SymbolKind;
  }
  const pathPrefix = args["path_prefix"];
  if (typeof pathPrefix === "string" && pathPrefix.length > 0) {
    options.pathPrefix = pathPrefix;
  }
  const className = args["class_name"];
  if (typeof className === "string" && className.length > 0) {
    options.className = className;
  }

  const hits = lookup.find(agentId, name, options);
  return JSON.stringify(
    hits.map((hit) => ({
      filePath: hit.filePath,
      kind: hit.kind,
      name: hit.name,
      qualifiedName: hit.qualifiedName,
      ...(hit.className === undefined ? {} : { className: hit.className }),
      startLine: hit.startLine,
      endLine: hit.endLine,
      rank: hit.rank,
    })),
  );
}

/** Build the ask-turn tool list and handlers for LocalProvider.sendMessage. */
export function buildAskTools(params: BuildAskToolsParams): {
  tools: ToolDefinition[];
  toolHandlers: Partial<Record<string, ToolHandler>>;
} {
  const { agentId, agenticTools, repoAccess, symbolLookup, store, updateBlock } = params;
  const tools: ToolDefinition[] = [];
  const toolHandlers: Partial<Record<string, ToolHandler>> = {};

  if (agenticTools) {
    tools.push(GREP_TOOL, GLOB_TOOL, READ_FILE_TOOL, FIND_SYMBOL_TOOL);
    toolHandlers["grep_repo"] = (args) => {
      if (repoAccess === undefined) return Promise.resolve(missingRepoAccessError());
      return Promise.resolve(handleGrepRepo(repoAccess, agentId, args));
    };
    toolHandlers["glob_files"] = async (args) => {
      if (repoAccess === undefined) return missingRepoAccessError();
      return handleGlobFiles(repoAccess, agentId, args);
    };
    toolHandlers["read_file"] = async (args) => {
      if (repoAccess === undefined) return missingRepoAccessError();
      return handleReadFile(repoAccess, agentId, args);
    };
    toolHandlers["find_symbol"] = (args) => {
      if (symbolLookup === undefined) return Promise.resolve(missingSymbolIndexError());
      return Promise.resolve(handleFindSymbol(symbolLookup, agentId, args));
    };
  }

  tools.push(ARCHIVAL_SEARCH_TOOL, MEMORY_REPLACE_TOOL);

  toolHandlers["archival_memory_search"] = async (args) => {
    const query = args["query"] as string;
    const pathPrefix = typeof args["path_prefix"] === "string" ? args["path_prefix"] : undefined;
    const requestedTopK = typeof args["top_k"] === "number" && Number.isFinite(args["top_k"])
      ? Math.floor(args["top_k"])
      : DEFAULT_SEARCH_RESULTS;
    const topK = Math.max(1, Math.min(MAX_SEARCH_RESULTS, requestedTopK));
    const results = await store.semanticSearch(
      agentId,
      query,
      Math.min(MAX_SEARCH_RESULTS * 2, topK * 2),
      pathPrefix === undefined || pathPrefix === "" ? undefined : { pathPrefix },
    );
    return JSON.stringify(budgetSearchResults(results, {
      limit: topK,
      maxTextChars: SEARCH_RESULT_TEXT_CHARS,
      maxPerFile: MAX_RESULTS_PER_FILE,
    }));
  };
  toolHandlers["memory_replace"] = async (args) => {
    const label = args["label"];
    const value = args["value"];
    if (typeof label !== "string" || !BLOCK_LABELS.includes(label as typeof BLOCK_LABELS[number])) {
      return `Error: block '${String(label)}' is not allowed. Use one of: ${BLOCK_LABELS.join(", ")}.`;
    }
    if (!MUTABLE_MEMORY_LABELS.has(label)) {
      return `Error: block '${label}' cannot be modified during an ask. Only 'architecture' and 'conventions' are allowed.`;
    }
    if (typeof value !== "string") {
      return `Error: value for '${label}' must be a string.`;
    }
    if (value.length > MEMORY_BLOCK_LIMIT) {
      return `Error: value for '${label}' is ${String(value.length)} chars, over the ${String(MEMORY_BLOCK_LIMIT)}-char limit.`;
    }
    await updateBlock(agentId, label, value);
    return `Updated block '${label}'`;
  };

  return { tools, toolHandlers };
}

export const CONSOLIDATION_MEMORY_REPLACE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "memory_replace",
    description: "Update the architecture or conventions memory block with new content",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string", description: "Block label (architecture or conventions)" },
        value: { type: "string", description: "New block content" },
      },
      required: ["label", "value"],
    },
  },
};
