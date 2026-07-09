import path from "node:path";
import { findDefinitions, type SymbolIndex, type SymbolLocation } from "./symbol-index.js";
import type { CallRef, ExportRef, ImportRef, SymbolRef } from "./symbol-refs.js";
import { isCallRef, isExportRef, isImportRef } from "./symbol-refs.js";

/** Stable id for a definition node in the graph. */
export function definitionNodeId(loc: Pick<SymbolLocation, "filePath" | "qualifiedName" | "startLine">): string {
  return `def:${loc.filePath}#${loc.qualifiedName}@${loc.startLine}`;
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
}

const RELATIVE_SPEC_RE = /^\.{1,2}\//;

/**
 * Resolve a relative ESM module specifier against the importing file's directory.
 * Tries common extensions and `/index` variants. Returns undefined for non-relative
 * or bare package specifiers (no package/`tsconfig` paths resolution in v1).
 */
export function resolveRelativeModule(
  fromFilePath: string,
  moduleSpecifier: string,
  knownFiles: ReadonlySet<string>,
): string | undefined {
  if (!RELATIVE_SPEC_RE.test(moduleSpecifier)) return undefined;

  const dir = path.posix.dirname(fromFilePath.replaceAll("\\", "/"));
  const joined = path.posix.normalize(path.posix.join(dir, moduleSpecifier));

  const candidates = [
    joined,
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.js`,
    `${joined}.jsx`,
    `${joined}.mts`,
    `${joined}.cts`,
    `${joined}.mjs`,
    `${joined}.cjs`,
    path.posix.join(joined, "index.ts"),
    path.posix.join(joined, "index.tsx"),
    path.posix.join(joined, "index.js"),
  ];

  for (const candidate of candidates) {
    if (knownFiles.has(candidate)) return candidate;
  }
  return undefined;
}

interface ImportBinding {
  /** Local name in the importing file. */
  local: string;
  /** Resolved target file path, if relative resolution succeeded. */
  targetFile?: string;
  /** Name in the target module (`default`, `*`, or exported id). */
  imported: string;
}

function collectExportsByFile(
  files: readonly FileSymbolBundle[],
): Map<string, ExportRef[]> {
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

function matchImportedSymbol(
  index: SymbolIndex,
  targetFile: string,
  imported: string,
  exportsInTarget: readonly ExportRef[] | undefined,
): SymbolLocation[] {
  if (imported === "*") {
    // Namespace import: edge to all exported defs in the target (or all defs if no export refs).
    if (exportsInTarget && exportsInTarget.length > 0) {
      const exportedIds = new Set<string>();
      for (const exp of exportsInTarget) {
        for (const name of exp.exportedNames) {
          if (name.exported !== "*") exportedIds.add(name.local ?? name.exported);
        }
      }
      return definitionsInFile(index, targetFile).filter(
        (d) => exportedIds.has(d.name) || exportedIds.has(d.qualifiedName),
      );
    }
    return definitionsInFile(index, targetFile);
  }

  if (imported === "default") {
    // Prefer a symbol literally named default, else first top-level export / first def.
    const defs = definitionsInFile(index, targetFile);
    const namedDefault = defs.find((d) => d.name === "default");
    if (namedDefault) return [namedDefault];
    if (exportsInTarget) {
      for (const exp of exportsInTarget) {
        for (const name of exp.exportedNames) {
          if (name.exported === "default" && name.local) {
            const hit = defs.find((d) => d.name === name.local);
            if (hit) return [hit];
          }
        }
      }
    }
    // Heuristic: first non-method definition in the file
    const top = defs.find((d) => d.kind !== "METHOD");
    return top ? [top] : [];
  }

  // Named import: match by name or via export alias (local → exported)
  const defs = definitionsInFile(index, targetFile);
  const byName = defs.filter((d) => d.name === imported || d.qualifiedName === imported);
  if (byName.length > 0) return byName;

  if (exportsInTarget) {
    for (const exp of exportsInTarget) {
      for (const name of exp.exportedNames) {
        if (name.exported === imported && name.local && name.local !== imported) {
          const hit = defs.filter((d) => d.name === name.local);
          if (hit.length > 0) return hit;
        }
      }
    }
  }
  return [];
}

function buildImportBindings(
  filePath: string,
  imports: readonly ImportRef[],
  knownFiles: ReadonlySet<string>,
): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  for (const imp of imports) {
    const targetFile = resolveRelativeModule(filePath, imp.moduleSpecifier, knownFiles);
    for (const name of imp.importedNames) {
      bindings.push({
        local: name.local,
        imported: name.imported,
        ...(targetFile === undefined ? {} : { targetFile }),
      });
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

/**
 * Build a directed symbol graph:
 * - import edges: importer file → imported definition(s)
 * - call edges: caller file → resolved definition(s)
 *
 * Ambiguous bare names get edges to all matches (Aider-style over-connect).
 * Non-relative module specifiers are skipped (no package resolution in v1).
 */
export function buildSymbolGraph(input: BuildSymbolGraphInput): SymbolGraph {
  const { index, files } = input;
  const knownFiles = new Set(files.map((f) => f.filePath));
  // Also include definition file paths that may lack refs
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

    const imports = file.refs.filter(isImportRef);
    const calls = file.refs.filter(isCallRef);
    const bindings = buildImportBindings(file.filePath, imports, knownFiles);

    // Import → symbol edges
    for (const binding of bindings) {
      if (binding.targetFile === undefined) continue;
      const targets = matchImportedSymbol(
        index,
        binding.targetFile,
        binding.imported,
        exportsByFile.get(binding.targetFile),
      );
      for (const target of targets) {
        const to = definitionNodeId(target);
        nodeSet.add(to);
        addEdge(edges, fileId, to, "import", seen);
      }
    }

    // Call → definition edges
    for (const call of calls) {
      const targets = resolveCallTargets(index, file.filePath, call, bindings);
      for (const target of targets) {
        const to = definitionNodeId(target);
        nodeSet.add(to);
        addEdge(edges, fileId, to, "call", seen);
      }
    }
  }

  // eslint-disable-next-line unicorn/no-array-sort -- Array#toSorted requires ES2023
  const nodes = [...nodeSet].sort((a, b) => a.localeCompare(b));
  return { nodes, edges };
}

function resolveCallTargets(
  index: SymbolIndex,
  callerFile: string,
  call: CallRef,
  bindings: readonly ImportBinding[],
): SymbolLocation[] {
  const qualified = call.objectName ? `${call.objectName}.${call.calleeName}` : call.calleeName;

  // 1. Same-file definitions (prefer qualified, then bare)
  const sameFile = index.symbols.filter((s) => s.filePath === callerFile);
  const sameQualified = sameFile.filter(
    (s) => s.qualifiedName === qualified || s.name === call.calleeName,
  );
  if (call.objectName) {
    const methodHits = sameFile.filter(
      (s) => s.name === call.calleeName && (s.className === call.objectName || s.qualifiedName === qualified),
    );
    if (methodHits.length > 0) return methodHits;
  }
  if (sameQualified.length > 0 && !call.objectName) {
    return sameQualified;
  }

  // 2. Imported local bindings
  if (!call.objectName) {
    const binding = bindings.find((b) => b.local === call.calleeName);
    if (binding?.targetFile) {
      const imported = matchImportedSymbol(
        index,
        binding.targetFile,
        binding.imported === "*" ? call.calleeName : binding.imported,
        undefined,
      );
      if (imported.length > 0) return imported;
    }
  } else {
    // obj.method() where obj is a namespace import
    const ns = bindings.find((b) => b.local === call.objectName && b.imported === "*");
    if (ns?.targetFile) {
      const hits = definitionsInFile(index, ns.targetFile).filter(
        (d) => d.name === call.calleeName || d.qualifiedName === call.calleeName,
      );
      if (hits.length > 0) return hits;
    }
    // obj.method() where obj is a default/class import
    const objBinding = bindings.find((b) => b.local === call.objectName);
    if (objBinding?.targetFile) {
      const classDefs = matchImportedSymbol(index, objBinding.targetFile, objBinding.imported, undefined);
      const classNames = new Set(classDefs.map((d) => d.name));
      const methods = definitionsInFile(index, objBinding.targetFile).filter(
        (d) => d.name === call.calleeName && d.className !== undefined && classNames.has(d.className),
      );
      if (methods.length > 0) return methods;
    }
  }

  // 3. Global findDefinitions (ambiguous → all matches)
  if (call.objectName) {
    const byQualified = findDefinitions(index, qualified);
    if (byQualified.length > 0) return byQualified;
    return findDefinitions(index, call.calleeName);
  }
  return findDefinitions(index, call.calleeName);
}
