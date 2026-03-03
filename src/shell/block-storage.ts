import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

export interface BlockStorage {
  get(agentId: string, label: string): string;
  set(agentId: string, label: string, value: string): void;
  init(agentId: string, blocks: Record<string, string>): void;
  delete(agentId: string): void;
}

export class FilesystemBlockStorage implements BlockStorage {
  constructor(private readonly baseDir: string) {}

  get(agentId: string, label: string): string {
    const p = path.join(this.baseDir, agentId, `${label}.txt`);
    // Path is constrained to the configured base dir and agent-scoped filenames.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!existsSync(p)) return "";
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return readFileSync(p, "utf8");
  }

  set(agentId: string, label: string, value: string): void {
    const dir = path.join(this.baseDir, agentId);
    // Path is constrained to the configured base dir and agent-scoped directory.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    mkdirSync(dir, { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    writeFileSync(path.join(dir, `${label}.txt`), value, "utf8");
  }

  init(agentId: string, blocks: Record<string, string>): void {
    const dir = path.join(this.baseDir, agentId);
    // Path is constrained to the configured base dir and agent-scoped directory.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    mkdirSync(dir, { recursive: true });
    for (const [label, value] of Object.entries(blocks)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      writeFileSync(path.join(dir, `${label}.txt`), value, "utf8");
    }
  }

  delete(agentId: string): void {
    const dir = path.join(this.baseDir, agentId);
    // Path is constrained to the configured base dir and agent-scoped directory.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (existsSync(dir)) rmSync(dir, { recursive: true });
  }
}
