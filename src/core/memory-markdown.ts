/**
 * Pure markdown memory-block format with YAML-ish frontmatter.
 * Used by git-versioned memory (product plan §5 item 3, Phase A).
 */

export interface MemoryBlockDocument {
  label: string;
  value: string;
  updatedAt?: string;
  sourceCommit?: string;
}

/**
 * Serialize a memory block to markdown with simple frontmatter.
 */
export function formatMemoryBlockMarkdown(doc: MemoryBlockDocument): string {
  const lines = ["---", `label: ${doc.label}`];
  if (doc.updatedAt !== undefined) lines.push(`updated_at: ${doc.updatedAt}`);
  if (doc.sourceCommit !== undefined) lines.push(`source_commit: ${doc.sourceCommit}`);
  lines.push("---", "", trimTrailingWhitespace(doc.value), "");
  return lines.join("\n");
}

function trimTrailingWhitespace(text: string): string {
  let end = text.length;
  while (end > 0) {
    const ch = text[end - 1];
    if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") break;
    end--;
  }
  return text.slice(0, end);
}

function trimLeadingWhitespace(text: string): string {
  let start = 0;
  while (start < text.length) {
    const ch = text[start];
    if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") break;
    start++;
  }
  return text.slice(start);
}

function readFrontmatterField(fields: Record<string, string>, key: string): string | undefined {
  const value = fields[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Parse a memory block markdown file. Falls back to whole-file body when
 * frontmatter is missing.
 */
export function parseMemoryBlockMarkdown(text: string, fallbackLabel: string): MemoryBlockDocument {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return { label: fallbackLabel, value: trimTrailingWhitespace(text) };
  }
  const afterOpen = text.startsWith("---\r\n") ? text.slice(5) : text.slice(4);
  const closeIdx = afterOpen.indexOf("\n---\n");
  const closeIdxCr = afterOpen.indexOf("\n---\r\n");
  let closeAt = -1;
  let bodyStart = 0;
  if (closeIdx !== -1 && (closeIdxCr === -1 || closeIdx <= closeIdxCr)) {
    closeAt = closeIdx;
    bodyStart = closeIdx + "\n---\n".length;
  } else if (closeIdxCr !== -1) {
    closeAt = closeIdxCr;
    bodyStart = closeIdxCr + "\n---\r\n".length;
  }
  if (closeAt === -1) {
    return { label: fallbackLabel, value: trimTrailingWhitespace(text) };
  }

  const front = afterOpen.slice(0, closeAt);
  const body = trimTrailingWhitespace(trimLeadingWhitespace(afterOpen.slice(bodyStart)));
  const fields: Record<string, string> = {};
  for (const line of front.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  const doc: MemoryBlockDocument = {
    label: fields["label"] ?? fallbackLabel,
    value: body,
  };
  const updatedAt = readFrontmatterField(fields, "updated_at");
  if (updatedAt !== undefined) doc.updatedAt = updatedAt;
  const sourceCommit = readFrontmatterField(fields, "source_commit");
  if (sourceCommit !== undefined) doc.sourceCommit = sourceCommit;
  return doc;
}
