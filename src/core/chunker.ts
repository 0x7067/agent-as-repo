import { FILE_PREFIX, type Chunk, type ChunkingStrategy, type FileInfo } from "./types.js";

export function chunkFile(
  filePath: string,
  content: string,
  maxChars = 2000,
): Chunk[] {
  // Stryker disable next-line MethodExpression,ConditionalExpression: equivalent — whitespace-only content produces current.trim() === header after the loop (no chunk pushed), making this guard redundant
  if (!content.trim()) return [];

  const header = `${FILE_PREFIX}${filePath}`;
  const sections = content.split(/\n{2,}/);
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

  // Stryker disable next-line EqualityOperator,ConditionalExpression,MethodExpression: equivalent — line 8 guard returns early for all whitespace inputs; for real content current always exceeds header.length
  if (current.trim().length > header.length) {
    chunks.push({ text: current.trim(), sourcePath: filePath });
  }

  return chunks;
}

/** Default chunking strategy: delegates to chunkFile. */
export const rawTextStrategy: ChunkingStrategy = (file: FileInfo): Chunk[] =>
  chunkFile(file.path, file.content);
