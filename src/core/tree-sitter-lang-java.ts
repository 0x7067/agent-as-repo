import type { Node, Tree } from "web-tree-sitter";
import { collectClassMethods, spanFromNode, type SymbolSpan } from "./tree-sitter-symbols.js";

/**
 * Java enums nest their methods one level deeper than classes/records: the `enum_body` field
 * holds constants plus (when present) a single `enum_body_declarations` wrapper node, and that
 * wrapper's named children are the class-body-style members (methods, fields, ...).
 */
function collectEnumMethods(enumNode: Node, enumName: string): SymbolSpan[] {
  const body = enumNode.childForFieldName("body");
  if (!body) return [];
  const declarations = body.namedChildren.find((child) => child.type === "enum_body_declarations");
  if (!declarations) return [];

  const methods: SymbolSpan[] = [];
  for (const member of declarations.namedChildren) {
    if (member.type !== "method_declaration") continue;
    const span = spanFromNode(member, "METHOD", enumName);
    if (span) methods.push(span);
  }
  return methods;
}

function extractFromJavaDeclaration(node: Node): SymbolSpan[] {
  switch (node.type) {
    case "class_declaration":
    case "record_declaration": {
      const cls = spanFromNode(node, "CLASS");
      if (!cls) return [];
      return [cls, ...collectClassMethods(node, cls.name, ["method_declaration"])];
    }
    case "interface_declaration": {
      const iface = spanFromNode(node, "INTERFACE");
      return iface ? [iface] : [];
    }
    case "enum_declaration": {
      const en = spanFromNode(node, "ENUM");
      if (!en) return [];
      return [en, ...collectEnumMethods(node, en.name)];
    }
    default: {
      return [];
    }
  }
}

export function extractSymbolSpansJava(tree: Tree): SymbolSpan[] {
  const spans: SymbolSpan[] = [];
  for (const child of tree.rootNode.namedChildren) {
    spans.push(...extractFromJavaDeclaration(child));
  }
  return spans;
}
