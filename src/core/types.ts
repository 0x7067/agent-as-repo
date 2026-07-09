export type { SymbolFileMap, SymbolRankMap } from "./symbol-store.js";
import type { SymbolFileMap, SymbolRankMap } from "./symbol-store.js";

/** A git submodule entry parsed from `git submodule status`. */
export interface SubmoduleInfo {
  /** Relative path from repo root (e.g. "libs/my-lib"). */
  path: string;
  /** The git commit hash the submodule is pinned to. */
  commit: string;
  /** False when the submodule has not been initialized (`git submodule update --init`). */
  initialized: boolean;
}

/** Files larger than this are never indexed. */
export const MAX_FILE_SIZE_KB = 50;

/** Max characters per core memory block. */
export const MEMORY_BLOCK_LIMIT = 5000;

/** Validated configuration for a single repo. */
export interface RepoConfig {
  path: string;
  basePath?: string;
  description: string;
  extensions: string[];
  ignoreDirs: string[];
  persona?: string;
  /** When true, files inside git submodules are indexed alongside the parent repo. */
  includeSubmodules?: boolean;
}

/**
 * Where embeddings come from: the OpenAI-compatible HTTP endpoint ("http")
 * or an in-process transformers.js pipeline ("transformersjs").
 */
export type EmbeddingEngine = "http" | "transformersjs";

export interface ProviderConfig {
  /** Chat model id as the LLM endpoint knows it. */
  model: string;
  /** OpenAI-compatible base URL (default: local Ollama). */
  baseUrl: string;
  /** Models tried in order after `model` on retryable failures. */
  fallbackModels: string[];
  /** Embedding engine (default "http": the OpenAI-compatible endpoint). */
  embeddingEngine: EmbeddingEngine;
  /** Embedding model id, as the selected embedding engine knows it. */
  embeddingModel: string;
  /** Smaller/faster chat model used when `ask --fast` is requested. No default. */
  fastModel?: string;
}

/** Top-level validated config. */
export interface Config {
  provider: ProviderConfig;
  /** When true, a successful sync triggers synchronous memory consolidation. */
  consolidateOnSync: boolean;
  repos: Record<string, RepoConfig>;
}

/** Prefix prepended to each chunk's header to identify the source file. */
export const FILE_PREFIX = "FILE: ";

/** Standard memory block labels used across agents. */
export const BLOCK_LABELS = ["persona", "architecture", "conventions"] as const;

/** A file's metadata + content, ready for chunking. */
export interface FileInfo {
  path: string;
  content: string;
  sizeKb: number;
}

/** A single chunk of a file, ready to become a passage. */
export interface Chunk {
  text: string;
  sourcePath: string;
}

/** A pluggable file-chunking strategy: takes a file and returns chunks. */
export type ChunkingStrategy = (file: FileInfo) => Chunk[];

/** Map of file path → passage ID for a single agent. */
export type PassageMap = Record<string, string[]>;

/** Map of file path → SHA-256 content hash for skip-unchanged reindex. */
export type FileHashMap = Record<string, string>;

/** Persisted state for a single agent. */
export interface AgentState {
  agentId: string;
  repoName: string;
  passages: PassageMap;
  /**
   * Per-file content hashes from the last successful index. Optional for
   * backward compatibility with older state files (missing → always reindex).
   */
  fileHashes?: FileHashMap;
  /**
   * Per-file symbol definitions + refs for the repo map. Invalidated with
   * `fileHashes` during sync. Optional for backward compatibility.
   */
  symbolFiles?: SymbolFileMap;
  /** PageRank scores keyed by graph node id (`def:…` / `file:…`), computed at sync. */
  symbolRanks?: SymbolRankMap;
  lastBootstrap: string | null;
  lastSyncCommit: string | null;
  lastSyncAt: string | null;
  createdAt: string;
  /** Commit HEAD was at when a consolidation last actually changed the blocks (unset until then). */
  lastConsolidatedCommit?: string | null;
}

/** Top-level persisted state. */
export interface AppState {
  stateVersion: number;
  agents: Record<string, AgentState>;
}
