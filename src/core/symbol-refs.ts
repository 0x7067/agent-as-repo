/**
 * Reference extraction types for the repo-map layer.
 * Separate from definition spans in tree-sitter-symbols / tree-sitter-lang-*.
 */

/** Local binding ↔ name in the imported module. */
export interface ImportedName {
  /** Binding name in the importing file. */
  local: string;
  /**
   * Name in the source module:
   * - `"default"` for default imports
   * - `"*"` for `import * as ns`
   * - otherwise the exported identifier (before `as` alias)
   */
  imported: string;
}

/** A name this file exports (declaration export or re-export). */
export interface ExportedName {
  /** Name as seen by importers of this module. */
  exported: string;
  /**
   * Local identifier when different from `exported` (e.g. `export { foo as bar }`).
   * For `export * from`, `exported` is `"*"` and `local` is omitted.
   */
  local?: string;
}

export interface ImportRef {
  kind: "import";
  moduleSpecifier: string;
  importedNames: readonly ImportedName[];
  startIndex: number;
  endIndex: number;
}

export interface ExportRef {
  kind: "export";
  exportedNames: readonly ExportedName[];
  /** Present for `export … from "mod"` re-exports. */
  moduleSpecifier?: string;
  startIndex: number;
  endIndex: number;
}

export interface CallRef {
  kind: "call";
  /** Callee identifier (`foo` in `foo()`, `bar` in `obj.bar()`, `Baz` in `new Baz()`). */
  calleeName: string;
  /** Object identifier for member calls (`obj` in `obj.bar()`). */
  objectName?: string;
  startIndex: number;
  endIndex: number;
}

export type SymbolRef = ImportRef | ExportRef | CallRef;

export function isImportRef(ref: SymbolRef): ref is ImportRef {
  return ref.kind === "import";
}

export function isExportRef(ref: SymbolRef): ref is ExportRef {
  return ref.kind === "export";
}

export function isCallRef(ref: SymbolRef): ref is CallRef {
  return ref.kind === "call";
}

export function filterRefsByKind<K extends SymbolRef["kind"]>(
  refs: readonly SymbolRef[],
  kind: K,
): Extract<SymbolRef, { kind: K }>[] {
  return refs.filter((ref): ref is Extract<SymbolRef, { kind: K }> => ref.kind === kind);
}
