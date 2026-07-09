import type { PassageStore } from "../ports/passage-store.js";
import type { RepoAccessPort } from "../ports/repo-access.js";
import type { ToolDefinition, ToolHandler } from "./llm-client.js";
import { handleGlobFiles, handleGrepRepo, handleReadFile } from "./repo-tools.js";

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
    description: "Read a file from the live repository by relative path",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from the repo root" },
      },
      required: ["path"],
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
        label: { type: "string", description: "Block label (persona, architecture, conventions)" },
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

export interface BuildAskToolsParams {
  agentId: string;
  agenticTools: boolean;
  repoAccess: RepoAccessPort | undefined;
  store: PassageStore;
  updateBlock: (agentId: string, label: string, value: string) => Promise<unknown>;
}

/** Build the ask-turn tool list and handlers for LocalProvider.sendMessage. */
export function buildAskTools(params: BuildAskToolsParams): {
  tools: ToolDefinition[];
  toolHandlers: Partial<Record<string, ToolHandler>>;
} {
  const { agentId, agenticTools, repoAccess, store, updateBlock } = params;
  const tools: ToolDefinition[] = [];
  const toolHandlers: Partial<Record<string, ToolHandler>> = {};

  if (agenticTools) {
    tools.push(GREP_TOOL, GLOB_TOOL, READ_FILE_TOOL);
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
  }

  tools.push(ARCHIVAL_SEARCH_TOOL, MEMORY_REPLACE_TOOL);

  toolHandlers["archival_memory_search"] = async (args) => {
    const query = args["query"] as string;
    const pathPrefix = typeof args["path_prefix"] === "string" ? args["path_prefix"] : undefined;
    const results = await store.semanticSearch(
      agentId,
      query,
      10,
      pathPrefix === undefined || pathPrefix === "" ? undefined : { pathPrefix },
    );
    return JSON.stringify(results);
  };
  toolHandlers["memory_replace"] = async (args) => {
    const label = args["label"] as string;
    const value = args["value"] as string;
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
