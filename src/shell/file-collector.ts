import * as fs from "fs/promises";
import * as path from "path";
import fg from "fast-glob";
import { shouldIncludeFile } from "../core/filter.js";
import type { RepoConfig, FileInfo } from "../core/types.js";

export async function collectFiles(config: RepoConfig): Promise<FileInfo[]> {
  const patterns = config.extensions.map((ext) => `**/*${ext}`);
  const ignore = config.ignoreDirs.map((dir) => `**/${dir}/**`);

  const entries = await fg(patterns, {
    cwd: config.path,
    ignore,
    absolute: false,
    dot: false,
  });

  const files: FileInfo[] = [];
  for (const relPath of entries) {
    const absPath = path.join(config.path, relPath);
    const stat = await fs.stat(absPath);
    const sizeKb = stat.size / 1024;

    if (
      shouldIncludeFile(relPath, sizeKb, {
        extensions: config.extensions,
        ignoreDirs: config.ignoreDirs,
        maxFileSizeKb: config.maxFileSizeKb,
      })
    ) {
      const content = await fs.readFile(absPath, "utf-8");
      files.push({ path: relPath, content, sizeKb });
    }
  }

  return files;
}
