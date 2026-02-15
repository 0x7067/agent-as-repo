import type { Chunk } from "./types.js";

export function chunkFile(
  filePath: string,
  content: string,
  maxChars = 2000,
): Chunk[] {
  if (!content.trim()) return [];

  const sections = content.split(/\n\n+/);
  const chunks: Chunk[] = [];
  let current = `FILE: ${filePath}\n\n`;

  for (const section of sections) {
    if (
      current.length + section.length > maxChars &&
      current.length > `FILE: ${filePath}\n\n`.length
    ) {
      chunks.push({ text: current.trim(), sourcePath: filePath });
      current = `FILE: ${filePath} (continued)\n\n`;
    }
    current += section + "\n\n";
  }

  if (current.trim().length > `FILE: ${filePath}`.length) {
    chunks.push({ text: current.trim(), sourcePath: filePath });
  }

  return chunks;
}
