/**
 * Minimal JSONC helpers (comments + trailing commas) for tsconfig/jsconfig.
 * Pure — no filesystem I/O.
 */

function skipLineComment(text: string, start: number): number {
  let i = start + 2;
  while (i < text.length && text[i] !== "\n") i++;
  return i;
}

function skipBlockComment(text: string, start: number): number {
  let i = start + 2;
  while (i + 1 < text.length && (text[i] !== "*" || text[i + 1] !== "/")) i++;
  return Math.min(i + 2, text.length);
}

function consumeString(text: string, start: number, out: string[]): number {
  const quote = text[start] ?? "";
  out.push(quote);
  let i = start + 1;
  let escaped = false;
  while (i < text.length) {
    const ch = text[i] ?? "";
    out.push(ch);
    if (escaped) {
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (ch === quote) {
      return i + 1;
    }
    i++;
  }
  return i;
}

/** Strip // and /* *\/ comments outside of strings. */
export function stripJsoncComments(text: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    const next = text[i + 1] ?? "";
    if (ch === '"' || ch === "'") {
      i = consumeString(text, i, out);
      continue;
    }
    if (ch === "/" && next === "/") {
      i = skipLineComment(text, i);
      continue;
    }
    if (ch === "/" && next === "*") {
      i = skipBlockComment(text, i);
      continue;
    }
    out.push(ch);
    i++;
  }
  return out.join("");
}

/**
 * Remove trailing commas before } or ] outside of strings.
 * Enough for typical tsconfig.jsonc; not a full JSON5 parser.
 */
export function stripTrailingCommas(text: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    if (ch === '"' || ch === "'") {
      i = consumeString(text, i, out);
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j] ?? "")) j++;
      const next = text[j] ?? "";
      if (next === "}" || next === "]") {
        i++;
        continue;
      }
    }
    out.push(ch);
    i++;
  }
  return out.join("");
}

/** Strip comments then trailing commas so JSON.parse can accept JSONC. */
export function prepareJsonc(text: string): string {
  return stripTrailingCommas(stripJsoncComments(text));
}
