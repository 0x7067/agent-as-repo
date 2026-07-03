import { FILE_PREFIX, type Chunk, type ChunkingStrategy, type FileInfo } from "./types.js";
import { treeSitterStrategy } from "./tree-sitter-chunker.js";

export function chunkWithHeader(
  header: string,
  content: string,
  sourcePath: string,
  maxChars = 2000,
): Chunk[] {
  if (!content.trim()) return [];

  const sections = content.split(/\n{2,}/);
  const chunks: Chunk[] = [];
  let current = `${header}\n\n`;

  for (const section of sections) {
    if (
      current.length + section.length > maxChars &&
      current.length > header.length + 2
    ) {
      chunks.push({ text: current.trim(), sourcePath });
      current = `${header} (continued)\n\n`;
    }
    current += section + "\n\n";
  }

  if (current.trim().length > header.length) {
    chunks.push({ text: current.trim(), sourcePath });
  }

  return chunks;
}

export function chunkFile(
  filePath: string,
  content: string,
  maxChars = 2000,
): Chunk[] {
  return chunkWithHeader(`${FILE_PREFIX}${filePath}`, content, filePath, maxChars);
}

/** Default chunking strategy: delegates to chunkFile. */
export const rawTextStrategy: ChunkingStrategy = (file: FileInfo): Chunk[] =>
  chunkFile(file.path, file.content);

export function selectChunkingStrategy(chunking: "raw" | "tree-sitter"): ChunkingStrategy {
  return chunking === "tree-sitter" ? treeSitterStrategy : rawTextStrategy;
}
