/* eslint-disable security/detect-non-literal-fs-filename -- memoryDir comes from config; paths are under that root */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  formatMemoryBlockMarkdown,
  parseMemoryBlockMarkdown,
} from "../core/memory-markdown.js";
import type { BlockStorage } from "./block-storage.js";

export interface GitMarkdownBlockStorageOptions {
  memoryDir: string;
  sourceCommit?: string;
}

/**
 * Persist Letta-style memory blocks as git-friendly markdown files.
 * Layout: `{memoryDir}/{agentId}/{label}.md`
 */
export class GitMarkdownBlockStorage implements BlockStorage {
  private readonly memoryDir: string;
  private readonly sourceCommit: string | undefined;

  constructor(options: GitMarkdownBlockStorageOptions) {
    this.memoryDir = options.memoryDir;
    this.sourceCommit = options.sourceCommit;
  }

  private agentDir(agentId: string): string {
    return path.join(this.memoryDir, agentId);
  }

  private blockPath(agentId: string, label: string): string {
    return path.join(this.agentDir(agentId), `${label}.md`);
  }

  get(agentId: string, label: string): string {
    try {
      const raw = readFileSync(this.blockPath(agentId, label), "utf8");
      return parseMemoryBlockMarkdown(raw, label).value;
    } catch {
      return "";
    }
  }

  set(agentId: string, label: string, value: string): void {
    const dir = this.agentDir(agentId);
    mkdirSync(dir, { recursive: true });
    const doc = {
      label,
      value,
      updatedAt: new Date().toISOString(),
      ...(this.sourceCommit === undefined ? {} : { sourceCommit: this.sourceCommit }),
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
