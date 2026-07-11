import { FILE_PREFIX } from "./types.js";

export interface RetrievedPassageView {
  id: string;
  text: string;
  score?: number;
}

const SNIPPET_MAX_CHARS = 160;

/** Extract the source file path from a chunk's "FILE: <path>" header line, if present. */
export function extractPassagePath(text: string): string | null {
  const firstLine = text.split("\n").at(0);
  if (firstLine === undefined || !firstLine.startsWith(FILE_PREFIX)) return null;
  return firstLine.slice(FILE_PREFIX.length).replace(/ \(continued\)$/, "");
}

/** Short single-line preview of a passage's body, skipping the "FILE:" header line when present. */
export function extractPassageSnippet(text: string, maxChars = SNIPPET_MAX_CHARS): string {
  const lines = text.split("\n");
  const bodyLines = lines.at(0)?.startsWith(FILE_PREFIX) ? lines.slice(1) : lines;
  const body = bodyLines.join(" ").trim().replaceAll(/\s+/g, " ");
  return body.length > maxChars ? `${body.slice(0, maxChars)}…` : body;
}

/**
 * Format retrieved passages as a human-readable audit trail (path + snippet +
 * score, when available) — so grounding can be checked without sqlite
 * spelunking. Pure: takes already-retrieved data, does no I/O.
 */
export function formatRetrievedPassages(passages: RetrievedPassageView[]): string {
  if (passages.length === 0) return "Retrieved passages: none.";

  const lines = [`Retrieved passages (${String(passages.length)}):`];
  passages.forEach((passage, index) => {
    const filePath = extractPassagePath(passage.text) ?? "(unknown file)";
    const scoreSuffix = passage.score === undefined ? "" : ` score=${passage.score.toFixed(3)}`;
    lines.push(`  ${String(index + 1)}. ${filePath}${scoreSuffix}`);
    lines.push(`     ${extractPassageSnippet(passage.text)}`);
  });
  return lines.join("\n");
}
