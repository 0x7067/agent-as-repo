import { FILE_PREFIX, type Chunk } from "./types.js";
import { filterRefsByKind, type SymbolRef } from "./symbol-refs.js";

/**
 * File-local context enrichment for embedding chunks.
 *
 * A chunk is one symbol (function/method/class) lifted out of its file. Once
 * retrieved in isolation it loses the surrounding file's import/export context —
 * the very signal that says "this is auth code" or "this is a React component".
 * `buildFileContext` distills that signal into a compact line prepended to every
 * chunk of the file before embedding, so the vector reflects the file's domain,
 * not just the symbol body.
 *
 * Deliberately file-local (the file's own imports/exports only, never
 * cross-file): the enriched chunk text stays a pure function of the file's
 * content, so the content-hash reindex cache in `syncRepo` remains valid — a
 * chunk never goes stale because some *other* file changed.
 */

const CONTEXT_LABEL = "CONTEXT | ";
/** Upper bound on the context line's own length (not the enriched total). */
const MAX_CONTEXT_CHARS = 300;
/** Default per-chunk size budget; enrichment stays within it (see `enrichChunks`). */
const DEFAULT_MAX_CHUNK_CHARS = 2000;
/** Cap names per group to keep import-heavy files from dominating the summary. */
const MAX_NAMES_PER_GROUP = 24;

/** Bare module name for topical signal: "./auth/session" → "session", "react" → "react". */
function moduleBasename(moduleSpecifier: string): string {
  const unquoted = moduleSpecifier.replaceAll(/^['"]|['"]$/g, "").replaceAll("\\", "/");
  const afterSlash = unquoted.slice(unquoted.lastIndexOf("/") + 1);
  return afterSlash.replace(/\.[a-z0-9]+$/i, "");
}

function sortedCappedNames(names: Iterable<string>): string[] {
  const unique = [...new Set(names)].filter((name) => name.length > 0);
  unique.sort((a, b) => a.localeCompare(b));
  return unique.slice(0, MAX_NAMES_PER_GROUP);
}

function collectImportNames(refs: readonly SymbolRef[]): string[] {
  const names = new Set<string>();
  for (const ref of filterRefsByKind(refs, "import")) {
    names.add(moduleBasename(ref.moduleSpecifier));
    for (const imported of ref.importedNames) {
      // "default"/"*" are synthetic markers; the useful token is the binding name.
      const name =
        imported.imported === "default" || imported.imported === "*"
          ? imported.local
          : imported.imported;
      names.add(name);
    }
  }
  return sortedCappedNames(names);
}

function collectExportNames(refs: readonly SymbolRef[]): string[] {
  const names = new Set<string>();
  for (const ref of filterRefsByKind(refs, "export")) {
    for (const exported of ref.exportedNames) {
      if (exported.exported !== "*") names.add(exported.exported);
    }
  }
  return sortedCappedNames(names);
}

/**
 * Build a one-line file-local context summary from a file's refs, or null when
 * the file has no imports/exports to summarize. Call refs are intentionally
 * excluded: within-file callees are already present in the chunk bodies, and
 * including them adds embedding noise without topical signal.
 */
export function buildFileContext(refs: readonly SymbolRef[]): string | null {
  const imports = collectImportNames(refs);
  const exports = collectExportNames(refs);
  if (imports.length === 0 && exports.length === 0) return null;

  const parts: string[] = [];
  if (imports.length > 0) parts.push(`imports: ${imports.join(", ")}`);
  if (exports.length > 0) parts.push(`exports: ${exports.join(", ")}`);
  const line = CONTEXT_LABEL + parts.join(" | ");
  return line.length > MAX_CONTEXT_CHARS ? line.slice(0, MAX_CONTEXT_CHARS) : line;
}

/**
 * Insert `context` as the second line of a chunk, keeping the `FILE:` header as
 * the strict first line. Downstream path extraction (`extractSourcePath`,
 * `passageFilePath`) only reads line one, so the header contract is preserved.
 * Self-enforces that contract: a chunk whose first line is not a `FILE:` header
 * (empty/degenerate input) is returned untouched rather than gaining a
 * non-header first line.
 */
function insertContextLine(text: string, context: string): string {
  if (!text.startsWith(FILE_PREFIX)) return text;
  const newlineIndex = text.indexOf("\n");
  if (newlineIndex === -1) return `${text}\n${context}`;
  const header = text.slice(0, newlineIndex);
  const rest = text.slice(newlineIndex + 1);
  return `${header}\n${context}\n${rest}`;
}

/**
 * Prepend the file-local context summary to every chunk of a file. Returns the
 * chunks unchanged when there is nothing to summarize (non-JS/TS/Py/Go files, or
 * files with no imports/exports).
 *
 * Enrichment is additive on top of already-packed chunks, so a chunk that has
 * no room for the context line within `maxChunkChars` is left unenriched rather
 * than pushed past the size budget — the passage size invariant always holds.
 */
export function enrichChunks(
  chunks: Chunk[],
  refs: readonly SymbolRef[],
  maxChunkChars = DEFAULT_MAX_CHUNK_CHARS,
): Chunk[] {
  const context = buildFileContext(refs);
  if (context === null) return chunks;
  return chunks.map((chunk) => {
    // +1 for the newline `insertContextLine` adds between header and context.
    if (chunk.text.length + context.length + 1 > maxChunkChars) return chunk;
    return { ...chunk, text: insertContextLine(chunk.text, context) };
  });
}
