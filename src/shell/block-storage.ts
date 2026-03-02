import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface BlockStorage {
  get(agentId: string, label: string): string;
  set(agentId: string, label: string, value: string): void;
  init(agentId: string, blocks: Record<string, string>): void;
  delete(agentId: string): void;
}

export class FilesystemBlockStorage implements BlockStorage {
  constructor(private readonly baseDir: string) {}

  get(agentId: string, label: string): string {
    const p = join(this.baseDir, agentId, `${label}.txt`);
    if (!existsSync(p)) return "";
    return readFileSync(p, "utf-8");
  }

  set(agentId: string, label: string, value: string): void {
    const dir = join(this.baseDir, agentId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${label}.txt`), value, "utf-8");
  }

  init(agentId: string, blocks: Record<string, string>): void {
    const dir = join(this.baseDir, agentId);
    mkdirSync(dir, { recursive: true });
    for (const [label, value] of Object.entries(blocks)) {
      writeFileSync(join(dir, `${label}.txt`), value, "utf-8");
    }
  }

  delete(agentId: string): void {
    const dir = join(this.baseDir, agentId);
    if (existsSync(dir)) rmSync(dir, { recursive: true });
  }
}
