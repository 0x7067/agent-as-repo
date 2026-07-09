import { readFileSync } from "node:fs";
import path from "node:path";
import { parsePathAliasConfig, type PathAliasConfig } from "../core/tsconfig-paths.js";

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

/** Strip // and /* *\/ comments outside of strings (JSONC subset). */
function stripJsonc(text: string): string {
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
 * Load path aliases from the nearest tsconfig.json / jsconfig.json under repoRoot.
 * Shell-only (fs). Returns undefined when missing or unparsable.
 */
export function loadPathAliasesFromRepo(repoRoot: string): PathAliasConfig | undefined {
  for (const name of ["tsconfig.json", "jsconfig.json"] as const) {
    const filePath = path.join(repoRoot, name);
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- repoRoot is a configured repo path
      const text = readFileSync(filePath, "utf8");
      const raw: unknown = JSON.parse(stripJsonc(text));
      const cfg = parsePathAliasConfig(raw);
      if (cfg !== undefined) return cfg;
    } catch {
      // try next
    }
  }
  return undefined;
}
