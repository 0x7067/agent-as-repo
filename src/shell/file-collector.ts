import path from "node:path";
import { MAX_INDEXABLE_FILE_SIZE_KB, type RepoConfig, type FileInfo, type SkippedFile } from "../core/types.js";
import type { FileSystemPort } from "../ports/filesystem.js";
import { nodeFileSystem } from "./adapters/node-filesystem.js";

export async function collectFiles(
  config: RepoConfig,
  fs: FileSystemPort = nodeFileSystem,
  onFileError?: (filePath: string, error: Error) => void,
  onSkip?: (skipped: SkippedFile) => void,
): Promise<FileInfo[]> {
  const cwd = config.basePath ? path.join(config.path, config.basePath) : config.path;
  const patterns = config.extensions.map((ext) => `**/*${ext}`);
  const ignore = config.ignoreDirs.map((dir) => `**/${dir}/**`);

  // fast-glob handles extension and ignoreDirs filtering; we only need the size check
  const entries = await fs.glob(patterns, {
    cwd,
    ignore,
    absolute: false,
    dot: false,
  });

  const files: FileInfo[] = [];
  for (const relPath of entries) {
    const absPath = path.join(cwd, relPath);
    // A single permission-denied file or broken/stale symlink must not abort
    // collection for the rest of the repo — skip it and report why.
    try {
      const stat = await fs.stat(absPath);
      const sizeKb = stat.size / 1024;

      if (sizeKb <= MAX_INDEXABLE_FILE_SIZE_KB) {
        const content = await fs.readFile(absPath, "utf8");
        files.push({ path: relPath, content, sizeKb });
      } else {
        onSkip?.({ path: relPath, sizeKb });
      }
    } catch (error_) {
      const error = error_ instanceof Error ? error_ : new Error(String(error_));
      onFileError?.(relPath, error);
    }
  }

  return files;
}
