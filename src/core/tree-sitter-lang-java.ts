import type { Node, Tree } from "web-tree-sitter";
import { collectClassMethods, spanFromNode, type SymbolSpan } from "./tree-sitter-symbols.js";

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
      return en ? [en] : [];
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
