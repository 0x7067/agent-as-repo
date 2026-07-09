import type { Node, Tree } from "web-tree-sitter";
import type { CallRef, ImportRef, SymbolRef } from "./symbol-refs.js";

function stringLiteralContent(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "interpreted_string_literal") {
    const content = node.namedChildren.find(
      (c) => c.type === "interpreted_string_literal_content",
    );
    if (content) return content.text;
    const text = node.text;
    if (text.length >= 2) return text.slice(1, -1);
  }
  return undefined;
}

function packageLocalName(path: string, nameNode: Node | null | undefined): { local: string; imported: string } {
  if (nameNode) {
    if (nameNode.type === "dot" || nameNode.text === ".") {
      return { local: path.split("/").at(-1) ?? path, imported: "*" };
    }
    if (nameNode.type === "package_identifier" || nameNode.type === "identifier") {
      return { local: nameNode.text, imported: "*" };
    }
  }
  const last = path.split("/").at(-1) ?? path;
  return { local: last, imported: "*" };
}

function extractImportSpec(spec: Node): ImportRef | undefined {
  const pathNode = spec.childForFieldName("path");
  const moduleSpecifier = stringLiteralContent(pathNode);
  if (moduleSpecifier === undefined) return undefined;
  const nameNode = spec.childForFieldName("name");
  const binding = packageLocalName(moduleSpecifier, nameNode);
  return {
    kind: "import",
    moduleSpecifier,
    importedNames: [binding],
    startIndex: spec.startIndex,
    endIndex: spec.endIndex,
  };
}

function collectImportSpecs(node: Node, refs: ImportRef[]): void {
  if (node.type === "import_spec") {
    const ref = extractImportSpec(node);
    if (ref) refs.push(ref);
    return;
  }
  if (node.type === "import_spec_list") {
    for (const spec of node.namedChildren) {
      collectImportSpecs(spec, refs);
    }
  }
}

function extractImportDeclaration(node: Node): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const child of node.namedChildren) {
    collectImportSpecs(child, refs);
  }
  return refs;
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

  if (fn.type === "selector_expression") {
    const operand = fn.childForFieldName("operand");
    const field = fn.childForFieldName("field");
    if (!field) return undefined;
    const objectName = operand?.type === "identifier" ? operand.text : undefined;
    return {
      kind: "call",
      calleeName: field.text,
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
  }
  for (const child of node.namedChildren) {
    walkCalls(child, out);
  }
}

/**
 * Extract import and call-site references from a Go tree-sitter AST.
 * No ExportRef — Go exports by capitalization, not statements.
 */
export function extractSymbolRefsGo(tree: Tree): SymbolRef[] {
  const refs: SymbolRef[] = [];

  for (const child of tree.rootNode.namedChildren) {
    if (child.type === "import_declaration") {
      refs.push(...extractImportDeclaration(child));
    }
  }

  const calls: CallRef[] = [];
  walkCalls(tree.rootNode, calls);
  refs.push(...calls);
  return refs;
}
