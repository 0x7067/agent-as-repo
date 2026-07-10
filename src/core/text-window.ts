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

  if (options.maxChars <= 1) {
    return {
      content: "…".slice(0, options.maxChars),
      startLine,
      endLine: startLine,
      totalLines,
      truncated: true,
    };
  }

  const prefix = selected.slice(0, options.maxChars - 1);
  const lastCompleteLineBreak = prefix.lastIndexOf("\n");
  if (lastCompleteLineBreak === -1) {
    return {
      content: `${prefix}…`,
      startLine,
      endLine: startLine,
      totalLines,
      truncated: true,
    };
  }

  const completeLines = prefix.slice(0, lastCompleteLineBreak);
  const returnedLineCount = completeLines.split("\n").length;
  return {
    content: `${completeLines}…`,
    startLine,
    endLine: startLine + returnedLineCount - 1,
    totalLines,
    truncated: true,
  };
}
