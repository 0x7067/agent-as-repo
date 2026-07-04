import type { Node, Tree } from "web-tree-sitter";
import { declaratorName, spanFromNode, type SymbolSpan } from "./tree-sitter-symbols.js";

/** `typedef struct Point Point;` -> the alias name is the *last* `type_identifier` direct child
 * (the struct/union/enum tag it aliases, if any, is an earlier one). */
function typedefAliasName(node: Node): string | undefined {
  const typeIdentifiers = node.namedChildren.filter((child) => child.type === "type_identifier");
  return typeIdentifiers.at(-1)?.text;
}

export function extractFromCDeclaration(node: Node): SymbolSpan[] {
  switch (node.type) {
    case "function_definition": {
      // Name is nested inside a function_declarator, not exposed via a "name" field.
      const fn = spanFromNode(node, "FUNCTION", undefined, undefined, declaratorName(node));
      return fn ? [fn] : [];
    }
    case "struct_specifier": {
      if (!node.childForFieldName("body")) return []; // forward declaration, no body to chunk
      const struct = spanFromNode(node, "STRUCT");
      return struct ? [struct] : [];
    }
    case "enum_specifier": {
      if (!node.childForFieldName("body")) return [];
      const en = spanFromNode(node, "ENUM");
      return en ? [en] : [];
    }
    case "type_definition": {
      const alias = spanFromNode(node, "TYPE", undefined, undefined, typedefAliasName(node));
      return alias ? [alias] : [];
    }
    default: {
      // Bare declarations/prototypes (`declaration` nodes) are intentionally not extracted.
      return [];
    }
  }
}

export function extractSymbolSpansC(tree: Tree): SymbolSpan[] {
  const spans: SymbolSpan[] = [];
  for (const child of tree.rootNode.namedChildren) {
    spans.push(...extractFromCDeclaration(child));
  }
  return spans;
}
