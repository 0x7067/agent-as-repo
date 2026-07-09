import type { Node, Tree } from "web-tree-sitter";
import type { CallRef, ImportedName, ImportRef, SymbolRef } from "./symbol-refs.js";

function dottedNameText(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "dotted_name" || node.type === "identifier") return node.text;
  if (node.type === "relative_import") return node.text;
  return node.text.length > 0 ? node.text : undefined;
}

function extractImportStatement(node: Node): ImportRef | undefined {
  // `import os` / `import os.path` — name field is dotted_name
  const nameNode = node.childForFieldName("name");
  const moduleSpecifier = dottedNameText(nameNode);
  if (moduleSpecifier === undefined) return undefined;
  const last = moduleSpecifier.split(".").at(-1) ?? moduleSpecifier;
  return {
    kind: "import",
    moduleSpecifier,
    importedNames: [{ local: last, imported: "*" }],
    startIndex: node.startIndex,
    endIndex: node.endIndex,
  };
}

function pushImportName(child: Node, importedNames: ImportedName[]): void {
  switch (child.type) {
    case "aliased_import": {
      const name = child.childForFieldName("name");
      const alias = child.childForFieldName("alias");
      const imported = dottedNameText(name);
      if (!imported) return;
      importedNames.push({ local: alias?.text ?? imported, imported });
      return;
    }
    case "dotted_name":
    case "identifier": {
      importedNames.push({ local: child.text, imported: child.text });
      return;
    }
    case "wildcard_import": {
      importedNames.push({ local: "*", imported: "*" });
      return;
    }
    default: {
      return;
    }
  }
}

function extractImportFromStatement(node: Node): ImportRef | undefined {
  const moduleNode = node.childForFieldName("module_name");
  const moduleSpecifier = dottedNameText(moduleNode) ?? "";
  const importedNames: ImportedName[] = [];

  for (let i = 0; i < node.childCount; i++) {
    if (node.fieldNameForChild(i) !== "name") continue;
    const child = node.child(i);
    if (!child?.isNamed) continue;
    pushImportName(child, importedNames);
  }

  if (importedNames.length === 0) {
    for (const child of node.namedChildren) {
      if (child === moduleNode) continue;
      if (child.type === "wildcard_import") {
        importedNames.push({ local: "*", imported: "*" });
      }
    }
  }

  return {
    kind: "import",
    moduleSpecifier,
    importedNames,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
  };
}

function callRefFromCall(node: Node): CallRef | undefined {
  const fn = node.childForFieldName("function");
  if (!fn) return undefined;

  if (fn.type === "identifier") {
    return {
      kind: "call",
      calleeName: fn.text,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    };
  }

  if (fn.type === "attribute") {
    const object = fn.childForFieldName("object");
    const attr = fn.childForFieldName("attribute");
    if (!attr) return undefined;
    const objectName = object?.type === "identifier" ? object.text : undefined;
    return {
      kind: "call",
      calleeName: attr.text,
      ...(objectName === undefined ? {} : { objectName }),
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    };
  }

  return undefined;
}

function walkCalls(node: Node, out: CallRef[]): void {
  if (node.type === "call") {
    const ref = callRefFromCall(node);
    if (ref) out.push(ref);
  }
  for (const child of node.namedChildren) {
    walkCalls(child, out);
  }
}

/**
 * Extract import and call-site references from a Python tree-sitter AST.
 * No ExportRef — Python has no export statements (defs are the export surface).
 * Imports are collected at module top-level only (nested/lazy imports are skipped in v1).
 */
export function extractSymbolRefsPython(tree: Tree): SymbolRef[] {
  const refs: SymbolRef[] = [];

  for (const child of tree.rootNode.namedChildren) {
    if (child.type === "import_statement") {
      const ref = extractImportStatement(child);
      if (ref) refs.push(ref);
    } else if (child.type === "import_from_statement") {
      const ref = extractImportFromStatement(child);
      if (ref) refs.push(ref);
    }
  }

  const calls: CallRef[] = [];
  walkCalls(tree.rootNode, calls);
  refs.push(...calls);
  return refs;
}
