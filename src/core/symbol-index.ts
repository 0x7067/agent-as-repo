import type { SymbolKind, SymbolSpan } from "./tree-sitter-symbols.js";

/** A definition located in a source file (flat index — no call/import edges yet). */
export interface SymbolLocation {
  filePath: string;
  kind: SymbolKind;
  name: string;
  /** e.g. `SyncOrchestrator.run` for methods, else bare `name`. */
  qualifiedName: string;
  className?: string;
  startIndex: number;
  endIndex: number;
  startLine: number;
  endLine: number;
}

export interface SymbolIndex {
  readonly symbols: readonly SymbolLocation[];
}

export interface FindDefinitionsOptions {
  kind?: SymbolKind;
  pathPrefix?: string;
  className?: string;
}

/** 1-based line number for a byte index into UTF-16/JS string content. */
export function indexLineAt(content: string, byteIndex: number): number {
  const clamped = Math.max(0, Math.min(byteIndex, content.length));
  let line = 1;
  for (let i = 0; i < clamped; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

export function qualifiedNameFor(span: SymbolSpan): string {
  if (span.className !== undefined && span.className.length > 0) {
    return `${span.className}.${span.name}`;
  }
  return span.name;
}

export function toSymbolLocation(
  filePath: string,
  content: string,
  span: SymbolSpan,
): SymbolLocation {
  return {
    filePath,
    kind: span.kind,
    name: span.name,
    qualifiedName: qualifiedNameFor(span),
    ...(span.className === undefined ? {} : { className: span.className }),
    startIndex: span.startIndex,
    endIndex: span.endIndex,
    startLine: indexLineAt(content, span.startIndex),
    endLine: indexLineAt(content, Math.max(span.startIndex, span.endIndex - 1)),
  };
}

export function buildSymbolIndex(
  files: ReadonlyArray<{ filePath: string; content: string; spans: readonly SymbolSpan[] }>,
): SymbolIndex {
  const symbols: SymbolLocation[] = [];
  for (const file of files) {
    for (const span of file.spans) {
      symbols.push(toSymbolLocation(file.filePath, file.content, span));
    }
  }
  return { symbols };
}

function compareLocations(a: SymbolLocation, b: SymbolLocation): number {
  const kindCmp = a.kind.localeCompare(b.kind);
  if (kindCmp !== 0) return kindCmp;
  const nameCmp = a.name.localeCompare(b.name);
  if (nameCmp !== 0) return nameCmp;
  return a.startLine - b.startLine;
}

export function listSymbolsInFile(index: SymbolIndex, filePath: string): SymbolLocation[] {
  return index.symbols
    .filter((symbol) => symbol.filePath === filePath)
    .slice()
    .sort(compareLocations);
}

export function findDefinitions(
  index: SymbolIndex,
  name: string,
  options: FindDefinitionsOptions = {},
): SymbolLocation[] {
  const { kind, pathPrefix, className } = options;
  return index.symbols.filter((symbol) => {
    if (symbol.name !== name && symbol.qualifiedName !== name) return false;
    if (kind !== undefined && symbol.kind !== kind) return false;
    if (pathPrefix !== undefined && !symbol.filePath.startsWith(pathPrefix)) return false;
    if (className !== undefined && symbol.className !== className) return false;
    return true;
  });
}
