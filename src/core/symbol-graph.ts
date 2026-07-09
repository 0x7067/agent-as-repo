import { findDefinitions, type SymbolIndex, type SymbolLocation } from "./symbol-index.js";
import type { CallRef, ExportRef, ImportRef, SymbolRef } from "./symbol-refs.js";
import { isCallRef, isExportRef, isImportRef } from "./symbol-refs.js";
import { resolveModuleSpecifier } from "./symbol-module-resolve.js";
import type { PathAliasConfig } from "./tsconfig-paths.js";

export {
  resolveModuleSpecifier,
  resolvePythonRelativeModule,
  resolveRelativeModule,
} from "./symbol-module-resolve.js";

/** Stable id for a definition node in the graph. */
export function definitionNodeId(loc: Pick<SymbolLocation, "filePath" | "qualifiedName" | "startLine">): string {
  return `def:${loc.filePath}#${loc.qualifiedName}@${String(loc.startLine)}`;
}

/** Stable id for a file node (import edges hang off these). */
export function fileNodeId(filePath: string): string {
  return `file:${filePath}`;
}

export type SymbolEdgeKind = "import" | "call";

export interface SymbolEdge {
  from: string;
  to: string;
  kind: SymbolEdgeKind;
}

export interface SymbolGraph {
  /** All node ids that participate in at least one edge or are known definitions. */
  readonly nodes: readonly string[];
  readonly edges: readonly SymbolEdge[];
}

export interface FileSymbolBundle {
  filePath: string;
  refs: readonly SymbolRef[];
}

export interface BuildSymbolGraphInput {
  index: SymbolIndex;
  files: readonly FileSymbolBundle[];
  /** Optional tsconfig path aliases for bare/aliased import resolution. */
  pathAliases?: PathAliasConfig;
}

interface ImportBinding {
  /** Local name in the importing file. */
  local: string;
  /** Resolved target file path, if relative resolution succeeded. */
  targetFile?: string;
  /** Name in the target module (`default`, `*`, or exported id). */
  imported: string;
}

function collectExportsByFile(files: readonly FileSymbolBundle[]): Map<string, ExportRef[]> {
  const map = new Map<string, ExportRef[]>();
  for (const file of files) {
    const exports = file.refs.filter(isExportRef);
    if (exports.length > 0) map.set(file.filePath, exports);
  }
  return map;
}

function definitionsInFile(index: SymbolIndex, filePath: string): SymbolLocation[] {
  return index.symbols.filter((s) => s.filePath === filePath);
}

function exportedLocalIds(exportsInTarget: readonly ExportRef[]): Set<string> {
  const exportedIds = new Set<string>();
  for (const exp of exportsInTarget) {
    for (const name of exp.exportedNames) {
      if (name.exported !== "*") exportedIds.add(name.local ?? name.exported);
    }
  }
  return exportedIds;
}

function matchNamespaceImport(
  index: SymbolIndex,
  targetFile: string,
  exportsInTarget: readonly ExportRef[] | undefined,
): SymbolLocation[] {
  const defs = definitionsInFile(index, targetFile);
  if (exportsInTarget === undefined || exportsInTarget.length === 0) return defs;
  const exportedIds = exportedLocalIds(exportsInTarget);
  return defs.filter((d) => exportedIds.has(d.name) || exportedIds.has(d.qualifiedName));
}

function findDefaultExportLocal(
  defs: readonly SymbolLocation[],
  exportsInTarget: readonly ExportRef[],
): SymbolLocation | undefined {
  for (const exp of exportsInTarget) {
    for (const name of exp.exportedNames) {
      if (name.exported === "default" && name.local !== undefined) {
        const hit = defs.find((d) => d.name === name.local);
        if (hit) return hit;
      }
    }
  }
  return undefined;
}

function matchDefaultImport(
  index: SymbolIndex,
  targetFile: string,
  exportsInTarget: readonly ExportRef[] | undefined,
): SymbolLocation[] {
  const defs = definitionsInFile(index, targetFile);
  const namedDefault = defs.find((d) => d.name === "default");
  if (namedDefault) return [namedDefault];

  if (exportsInTarget !== undefined) {
    const fromExport = findDefaultExportLocal(defs, exportsInTarget);
    if (fromExport) return [fromExport];
  }

  const top = defs.find((d) => d.kind !== "METHOD");
  return top === undefined ? [] : [top];
}

function matchNamedImport(
  index: SymbolIndex,
  targetFile: string,
  imported: string,
  exportsInTarget: readonly ExportRef[] | undefined,
): SymbolLocation[] {
  const defs = definitionsInFile(index, targetFile);
  const byName = defs.filter((d) => d.name === imported || d.qualifiedName === imported);
  if (byName.length > 0) return byName;

  if (exportsInTarget === undefined) return [];
  for (const exp of exportsInTarget) {
    for (const name of exp.exportedNames) {
      if (name.exported === imported && name.local !== undefined && name.local !== imported) {
        const hit = defs.filter((d) => d.name === name.local);
        if (hit.length > 0) return hit;
      }
    }
  }
  return [];
}

function matchImportedSymbol(
  index: SymbolIndex,
  targetFile: string,
  imported: string,
  exportsInTarget?: readonly ExportRef[],
): SymbolLocation[] {
  if (imported === "*") return matchNamespaceImport(index, targetFile, exportsInTarget);
  if (imported === "default") return matchDefaultImport(index, targetFile, exportsInTarget);
  return matchNamedImport(index, targetFile, imported, exportsInTarget);
}

function buildImportBindings(
  filePath: string,
  imports: readonly ImportRef[],
  knownFiles: ReadonlySet<string>,
  pathAliases?: PathAliasConfig,
): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  for (const imp of imports) {
    const targetFile = resolveModuleSpecifier(filePath, imp.moduleSpecifier, knownFiles, pathAliases);
    for (const name of imp.importedNames) {
      const binding: ImportBinding = { local: name.local, imported: name.imported };
      if (targetFile !== undefined) binding.targetFile = targetFile;
      bindings.push(binding);
    }
  }
  return bindings;
}

function addEdge(edges: SymbolEdge[], from: string, to: string, kind: SymbolEdgeKind, seen: Set<string>): void {
  const key = `${kind}|${from}|${to}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push({ from, to, kind });
}

function addResolvedEdges(
  edges: SymbolEdge[],
  seen: Set<string>,
  nodeSet: Set<string>,
  from: string,
  targets: readonly SymbolLocation[],
  kind: SymbolEdgeKind,
): void {
  for (const target of targets) {
    const to = definitionNodeId(target);
    nodeSet.add(to);
    addEdge(edges, from, to, kind, seen);
  }
}

function resolveSameFileCall(
  sameFile: readonly SymbolLocation[],
  call: CallRef,
  qualified: string,
): SymbolLocation[] {
  if (call.objectName !== undefined) {
    return sameFile.filter(
      (s) => s.name === call.calleeName && (s.className === call.objectName || s.qualifiedName === qualified),
    );
  }
  return sameFile.filter((s) => s.qualifiedName === qualified || s.name === call.calleeName);
}

function resolveImportedBareCall(
  index: SymbolIndex,
  call: CallRef,
  bindings: readonly ImportBinding[],
): SymbolLocation[] {
  const binding = bindings.find((b) => b.local === call.calleeName);
  if (binding?.targetFile === undefined) return [];
  const importedName = binding.imported === "*" ? call.calleeName : binding.imported;
  return matchImportedSymbol(index, binding.targetFile, importedName);
}

function resolveMemberCallViaImport(
  index: SymbolIndex,
  call: CallRef,
  bindings: readonly ImportBinding[],
): SymbolLocation[] {
  const objectName = call.objectName;
  if (objectName === undefined) return [];

  const ns = bindings.find((b) => b.local === objectName && b.imported === "*");
  if (ns?.targetFile !== undefined) {
    const hits = definitionsInFile(index, ns.targetFile).filter(
      (d) => d.name === call.calleeName || d.qualifiedName === call.calleeName,
    );
    if (hits.length > 0) return hits;
  }

  const objBinding = bindings.find((b) => b.local === objectName);
  if (objBinding?.targetFile === undefined) return [];

  const classDefs = matchImportedSymbol(index, objBinding.targetFile, objBinding.imported);
  const classNames = new Set(classDefs.map((d) => d.name));
  return definitionsInFile(index, objBinding.targetFile).filter(
    (d) => d.name === call.calleeName && d.className !== undefined && classNames.has(d.className),
  );
}

function resolveCallTargets(
  index: SymbolIndex,
  callerFile: string,
  call: CallRef,
  bindings: readonly ImportBinding[],
): SymbolLocation[] {
  const qualified = call.objectName === undefined ? call.calleeName : `${call.objectName}.${call.calleeName}`;
  const sameFile = index.symbols.filter((s) => s.filePath === callerFile);
  const localHits = resolveSameFileCall(sameFile, call, qualified);
  if (localHits.length > 0) return localHits;

  if (call.objectName === undefined) {
    const imported = resolveImportedBareCall(index, call, bindings);
    if (imported.length > 0) return imported;
    return findDefinitions(index, call.calleeName);
  }

  const memberHits = resolveMemberCallViaImport(index, call, bindings);
  if (memberHits.length > 0) return memberHits;

  const byQualified = findDefinitions(index, qualified);
  if (byQualified.length > 0) return byQualified;
  return findDefinitions(index, call.calleeName);
}

/**
 * Build a directed symbol graph:
 * - import edges: importer file → imported definition(s)
 * - call edges: caller file → resolved definition(s)
 *
 * Ambiguous bare names get edges to all matches (Aider-style over-connect).
 * Relative ESM/Python imports and tsconfig `paths` aliases resolve when known;
 * bare package imports (e.g. `lodash`) are skipped (no node_modules resolution).
 */
export function buildSymbolGraph(input: BuildSymbolGraphInput): SymbolGraph {
  const { index, files, pathAliases } = input;
  const knownFiles = new Set(files.map((f) => f.filePath));
  for (const sym of index.symbols) knownFiles.add(sym.filePath);

  const exportsByFile = collectExportsByFile(files);
  const edges: SymbolEdge[] = [];
  const seen = new Set<string>();
  const nodeSet = new Set<string>();

  for (const sym of index.symbols) {
    nodeSet.add(definitionNodeId(sym));
  }

  for (const file of files) {
    const fileId = fileNodeId(file.filePath);
    nodeSet.add(fileId);
    const bindings = buildImportBindings(
      file.filePath,
      file.refs.filter(isImportRef),
      knownFiles,
      pathAliases,
    );

    for (const binding of bindings) {
      if (binding.targetFile === undefined) continue;
      addResolvedEdges(
        edges,
        seen,
        nodeSet,
        fileId,
        matchImportedSymbol(index, binding.targetFile, binding.imported, exportsByFile.get(binding.targetFile)),
        "import",
      );
    }

    for (const call of file.refs.filter(isCallRef)) {
      addResolvedEdges(edges, seen, nodeSet, fileId, resolveCallTargets(index, file.filePath, call, bindings), "call");
    }
  }

  // eslint-disable-next-line unicorn/no-array-sort -- Array#toSorted requires ES2023
  const nodes = [...nodeSet].sort((a, b) => a.localeCompare(b));
  return { nodes, edges };
}
