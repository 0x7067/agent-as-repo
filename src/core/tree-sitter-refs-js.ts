import type { Node, Tree } from "web-tree-sitter";
import type {
  CallRef,
  ExportedName,
  ExportRef,
  ImportedName,
  ImportRef,
  SymbolRef,
} from "./symbol-refs.js";

function stringLiteralValue(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "string") {
    const fragment = node.namedChildren.find((child) => child.type === "string_fragment");
    if (fragment) return fragment.text;
    const text = node.text;
    if (text.length >= 2) return text.slice(1, -1);
  }
  return undefined;
}

function collectImportedNames(clause: Node): ImportedName[] {
  const names: ImportedName[] = [];

  for (const child of clause.namedChildren) {
    if (child.type === "identifier") {
      names.push({ local: child.text, imported: "default" });
      continue;
    }
    if (child.type === "namespace_import") {
      const id = child.namedChildren.find((n) => n.type === "identifier");
      if (id) names.push({ local: id.text, imported: "*" });
      continue;
    }
    if (child.type === "named_imports") {
      for (const spec of child.namedChildren) {
        if (spec.type !== "import_specifier") continue;
        const nameNode = spec.childForFieldName("name");
        const aliasNode = spec.childForFieldName("alias");
        if (!nameNode) continue;
        const imported = nameNode.text;
        const local = aliasNode?.text ?? imported;
        names.push({ local, imported });
      }
    }
  }

  return names;
}

function extractImportRef(node: Node): ImportRef | undefined {
  const source = stringLiteralValue(node.childForFieldName("source"));
  if (source === undefined) return undefined;

  const clause = node.namedChildren.find((child) => child.type === "import_clause");
  const importedNames = clause ? collectImportedNames(clause) : [];

  return {
    kind: "import",
    moduleSpecifier: source,
    importedNames,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
  };
}

function exportedNamesFromDeclaration(declaration: Node): ExportedName[] {
  switch (declaration.type) {
    case "function_declaration":
    case "class_declaration":
    case "interface_declaration":
    case "type_alias_declaration":
    case "enum_declaration": {
      const name = declaration.childForFieldName("name");
      return name ? [{ exported: name.text, local: name.text }] : [];
    }
    case "lexical_declaration":
    case "variable_declaration": {
      const names: ExportedName[] = [];
      for (const declarator of declaration.namedChildren) {
        if (declarator.type !== "variable_declarator") continue;
        const name = declarator.childForFieldName("name");
        if (name && name.type === "identifier") {
          names.push({ exported: name.text, local: name.text });
        }
      }
      return names;
    }
    default: {
      return [];
    }
  }
}

function extractExportRef(node: Node): ExportRef | undefined {
  const source = stringLiteralValue(node.childForFieldName("source"));
  const declaration = node.childForFieldName("declaration");

  if (declaration) {
    const exportedNames = exportedNamesFromDeclaration(declaration);
    if (exportedNames.length === 0) return undefined;
    return {
      kind: "export",
      exportedNames,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    };
  }

  const clause = node.namedChildren.find((child) => child.type === "export_clause");
  if (clause) {
    const exportedNames: ExportedName[] = [];
    for (const spec of clause.namedChildren) {
      if (spec.type !== "export_specifier") continue;
      const nameNode = spec.childForFieldName("name");
      const aliasNode = spec.childForFieldName("alias");
      if (!nameNode) continue;
      const local = nameNode.text;
      const exported = aliasNode?.text ?? local;
      exportedNames.push({ exported, local });
    }
    return {
      kind: "export",
      exportedNames,
      ...(source === undefined ? {} : { moduleSpecifier: source }),
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    };
  }

  // `export * from "mod"` — no export_clause, only source
  if (source !== undefined) {
    return {
      kind: "export",
      exportedNames: [{ exported: "*" }],
      moduleSpecifier: source,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    };
  }

  return undefined;
}

function callRefFromCallExpression(node: Node): CallRef | undefined {
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

  if (fn.type === "member_expression") {
    const object = fn.childForFieldName("object");
    const property = fn.childForFieldName("property");
    if (!property) return undefined;
    const objectName = object?.type === "identifier" ? object.text : undefined;
    return {
      kind: "call",
      calleeName: property.text,
      ...(objectName === undefined ? {} : { objectName }),
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    };
  }

  return undefined;
}

function callRefFromNewExpression(node: Node): CallRef | undefined {
  const ctor = node.childForFieldName("constructor");
  if (!ctor) return undefined;

  if (ctor.type === "identifier") {
    return {
      kind: "call",
      calleeName: ctor.text,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    };
  }

  if (ctor.type === "member_expression") {
    const object = ctor.childForFieldName("object");
    const property = ctor.childForFieldName("property");
    if (!property) return undefined;
    const objectName = object?.type === "identifier" ? object.text : undefined;
    return {
      kind: "call",
      calleeName: property.text,
      ...(objectName === undefined ? {} : { objectName }),
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    };
  }

  return undefined;
}

function walkCalls(node: Node, out: CallRef[]): void {
  if (node.type === "call_expression") {
    const ref = callRefFromCallExpression(node);
    if (ref) out.push(ref);
  } else if (node.type === "new_expression") {
    const ref = callRefFromNewExpression(node);
    if (ref) out.push(ref);
  }

  for (const child of node.namedChildren) {
    walkCalls(child, out);
  }
}

/**
 * Extract import, export, and call-site references from a JS/TS/TSX tree-sitter AST.
 * Does not extract definitions — keep separate from `extractSymbolSpansJsTs`.
 */
export function extractSymbolRefsJsTs(tree: Tree): SymbolRef[] {
  const refs: SymbolRef[] = [];

  for (const child of tree.rootNode.namedChildren) {
    if (child.type === "import_statement") {
      const ref = extractImportRef(child);
      if (ref) refs.push(ref);
    } else if (child.type === "export_statement") {
      const ref = extractExportRef(child);
      if (ref) refs.push(ref);
    }
  }

  const calls: CallRef[] = [];
  walkCalls(tree.rootNode, calls);
  refs.push(...calls);

  return refs;
}
