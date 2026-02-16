import * as fs from "fs/promises";
import * as path from "path";
import fg from "fast-glob";
import type { RepoConfig, FileInfo } from "../core/types.js";

export async function collectFiles(config: RepoConfig): Promise<FileInfo[]> {
  const cwd = config.basePath ? path.join(config.path, config.basePath) : config.path;
  const patterns = config.extensions.map((ext) => `**/*${ext}`);
  const ignore = config.ignoreDirs.map((dir) => `**/${dir}/**`);

  // fast-glob handles extension and ignoreDirs filtering; we only need the size check
  const entries = await fg(patterns, {
    cwd,
    ignore,
    absolute: false,
    dot: false,
  });

  const files: FileInfo[] = [];
  for (const relPath of entries) {
    const absPath = path.join(cwd, relPath);
    const stat = await fs.stat(absPath);
    const sizeKb = stat.size / 1024;

    if (sizeKb <= config.maxFileSizeKb) {
      const content = await fs.readFile(absPath, "utf-8");
      files.push({ path: relPath, content, sizeKb });
    }
  }

  return files;
}
