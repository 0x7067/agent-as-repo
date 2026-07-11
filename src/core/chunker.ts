import { FILE_PREFIX, type Chunk, type ChunkingStrategy, type FileInfo } from "./types.js";

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
  let hasContent = false;

  const flush = (): void => {
    if (!hasContent) return;
    chunks.push({ text: current.trim(), sourcePath });
    current = `${header} (continued)\n\n`;
    hasContent = false;
  };

  for (const section of sections) {
    let remaining = section;
    while (remaining.length > 0) {
      if (hasContent && current.length + remaining.length > maxChars) {
        flush();
        continue;
      }

      const available = maxChars - current.length;
      if (available <= 0) {
        throw new RangeError(
          `chunk header leaves no content room within the ${String(maxChars)}-character limit`,
        );
      }
      if (remaining.length <= available) {
        current += remaining + "\n\n";
        hasContent = true;
        remaining = "";
        continue;
      }

      // A single paragraph/symbol can exceed maxChars. Hard-split it so one
      // pathological source section cannot create an unbounded passage.
      const take = Math.max(1, available);
      current += remaining.slice(0, take);
      remaining = remaining.slice(take);
      hasContent = true;
      flush();
    }
  }

  flush();

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

/**
 * Raw-text fallback strategy: splits on blank lines with a `FILE:` header.
 * Used as the internal parse-failure fallback inside `treeSitterStrategy` and
 * injected directly by tests; production always chunks with tree-sitter.
 */
export const rawTextStrategy: ChunkingStrategy = (file: FileInfo): Chunk[] =>
  chunkFile(file.path, file.content);
