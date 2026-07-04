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

const CONTINUED_SUFFIX = " (continued)";

/**
 * Recover the source file path from a chunk's `FILE: <path>` header.
 * Returns null when the text carries no header (e.g. manually inserted passages).
 */
export function extractSourcePath(chunkText: string): string | null {
  if (!chunkText.startsWith(FILE_PREFIX)) return null;
  const newlineIndex = chunkText.indexOf("\n");
  const headerLine = newlineIndex === -1 ? chunkText : chunkText.slice(0, newlineIndex);
  let rawPath = headerLine.slice(FILE_PREFIX.length);
  if (rawPath.endsWith(CONTINUED_SUFFIX)) {
    rawPath = rawPath.slice(0, -CONTINUED_SUFFIX.length);
  }
  const trimmed = rawPath.trim();
  return trimmed.length > 0 ? trimmed : null;
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
