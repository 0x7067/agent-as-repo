/** Validated configuration for a single repo. */
export interface RepoConfig {
  path: string;
  basePath?: string;
  description: string;
  extensions: string[];
  ignoreDirs: string[];
  tags: string[];
  persona?: string;
  tools?: string[];
  maxFileSizeKb: number;
  memoryBlockLimit: number;
  bootstrapOnCreate: boolean;
}

/** Top-level validated config. */
export interface Config {
  letta: {
    model: string;
    embedding: string;
  };
  defaults: {
    maxFileSizeKb: number;
    memoryBlockLimit: number;
    bootstrapOnCreate: boolean;
  };
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

/** Map of file path → passage ID for a single agent. */
export type PassageMap = Record<string, string[]>;

/** Persisted state for a single agent. */
export interface AgentState {
  agentId: string;
  repoName: string;
  passages: PassageMap;
  lastBootstrap: string | null;
  lastSyncCommit: string | null;
  lastSyncAt: string | null;
  createdAt: string;
}

/** Top-level persisted state. */
export interface AppState {
  agents: Record<string, AgentState>;
}
