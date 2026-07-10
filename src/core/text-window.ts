export interface TextWindowOptions {
  startLine: number;
  endLine: number;
  maxChars: number;
}

export interface TextWindow {
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
}

/** Select a one-based line range and enforce a strict character budget. */
export function windowText(text: string, options: TextWindowOptions): TextWindow {
  const lines = text.split("\n");
  const totalLines = lines.length;
  const startLine = Math.min(Math.max(1, options.startLine), totalLines);
  const endLine = Math.min(Math.max(startLine, options.endLine), totalLines);
  const selected = lines.slice(startLine - 1, endLine).join("\n");

  if (selected.length <= options.maxChars) {
    return { content: selected, startLine, endLine, totalLines, truncated: false };
  }

  const content = options.maxChars <= 1
    ? "…".slice(0, options.maxChars)
    : `${selected.slice(0, options.maxChars - 1)}…`;
  return { content, startLine, endLine, totalLines, truncated: true };
}
