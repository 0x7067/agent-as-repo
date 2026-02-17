import { FILE_PREFIX, type Chunk, type ChunkingStrategy, type FileInfo } from "./types.js";

export function chunkFile(
  filePath: string,
  content: string,
  maxChars = 2000,
): Chunk[] {
  if (!content.trim()) return [];

  const header = `${FILE_PREFIX}${filePath}`;
  const sections = content.split(/\n\n+/);
  const chunks: Chunk[] = [];
  let current = `${header}\n\n`;

  for (const section of sections) {
    if (
      current.length + section.length > maxChars &&
      current.length > header.length + 2
    ) {
      chunks.push({ text: current.trim(), sourcePath: filePath });
      current = `${header} (continued)\n\n`;
    }
    current += section + "\n\n";
  }

  if (current.trim().length > header.length) {
    chunks.push({ text: current.trim(), sourcePath: filePath });
  }

  return chunks;
}

/** Default chunking strategy: delegates to chunkFile. */
export const rawTextStrategy: ChunkingStrategy = (file: FileInfo): Chunk[] =>
  chunkFile(file.path, file.content);
