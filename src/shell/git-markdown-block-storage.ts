/* eslint-disable security/detect-non-literal-fs-filename -- memoryDir comes from config; paths are sanitized under that root */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { resolveSafeMemoryPath } from "../core/memory-path.js";
import {
  formatMemoryBlockMarkdown,
  parseMemoryBlockMarkdown,
} from "../core/memory-markdown.js";
import type { BlockStorage } from "./block-storage.js";

export interface GitMarkdownBlockStorageOptions {
  memoryDir: string;
  /** Optional commit SHA stamped into frontmatter on write. */
  sourceCommit?: string;
  /** Optional per-agent commit resolver, evaluated at write time. */
  sourceCommitForAgent?: (agentId: string) => string | undefined;
}

/**
 * Persist Letta-style memory blocks as git-friendly markdown files.
 * Layout: `{memoryDir}/{agentId}/{label}.md`
 */
export class GitMarkdownBlockStorage implements BlockStorage {
  private readonly memoryDir: string;
  private readonly sourceCommitForAgent: ((agentId: string) => string | undefined) | undefined;
  private sourceCommit: string | undefined;

  constructor(options: GitMarkdownBlockStorageOptions) {
    this.memoryDir = path.resolve(options.memoryDir);
    this.sourceCommit = options.sourceCommit;
    this.sourceCommitForAgent = options.sourceCommitForAgent;
  }

  /** Update provenance stamped on subsequent writes (e.g. after sync). */
  setSourceCommit(commit: string | undefined): void {
    this.sourceCommit = commit;
  }

  private agentDir(agentId: string): string {
    return resolveSafeMemoryPath(this.memoryDir, agentId);
  }

  private blockPath(agentId: string, label: string): string {
    return resolveSafeMemoryPath(this.memoryDir, agentId, `${label}.md`);
  }

  get(agentId: string, label: string): string {
    try {
      const raw = readFileSync(this.blockPath(agentId, label), "utf8");
      return parseMemoryBlockMarkdown(raw, label).value;
    } catch (error) {
      if (error instanceof Error && /escapes|separators|rejects|invalid|required/i.test(error.message)) {
        throw error;
      }
      return "";
    }
  }

  set(agentId: string, label: string, value: string): void {
    const dir = this.agentDir(agentId);
    mkdirSync(dir, { recursive: true });
    const sourceCommit = this.sourceCommitForAgent?.(agentId) ?? this.sourceCommit;
    const doc = {
      label,
      value,
      updatedAt: new Date().toISOString(),
      ...(sourceCommit === undefined ? {} : { sourceCommit }),
    };
    writeFileSync(this.blockPath(agentId, label), formatMemoryBlockMarkdown(doc), "utf8");
  }

  init(agentId: string, blocks: Record<string, string>): void {
    for (const [label, value] of Object.entries(blocks)) {
      this.set(agentId, label, value);
    }
  }

  delete(agentId: string): void {
    const dir = this.agentDir(agentId);
    if (!existsSync(dir)) return;
    rmSync(dir, { recursive: true, force: true });
  }

  /** List labels present for an agent (test/debug helper). */
  listLabels(agentId: string): string[] {
    const dir = this.agentDir(agentId);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .map((name) => name.slice(0, -3));
  }
}
/* eslint-enable security/detect-non-literal-fs-filename */
