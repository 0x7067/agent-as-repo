import type { Node, Tree } from "web-tree-sitter";
import { collectClassMethods, spanFromNode, type SymbolSpan } from "./tree-sitter-symbols.js";

function extractFromPhpDeclaration(node: Node): SymbolSpan[] {
  switch (node.type) {
    case "function_definition": {
      const fn = spanFromNode(node, "FUNCTION");
      return fn ? [fn] : [];
    }
    case "class_declaration": {
      const cls = spanFromNode(node, "CLASS");
      if (!cls) return [];
      return [cls, ...collectClassMethods(node, cls.name, ["method_declaration"])];
    }
    case "interface_declaration": {
      const iface = spanFromNode(node, "INTERFACE");
      return iface ? [iface] : [];
    }
    case "trait_declaration": {
      const trait = spanFromNode(node, "TRAIT");
      return trait ? [trait] : [];
    }
    case "enum_declaration": {
      // PHP 8.1 backed/pure enums. Their body (`enum_declaration_list`) can also hold
      // `method_declaration` members exactly like a class body, so collectClassMethods applies
      // unchanged.
      const en = spanFromNode(node, "ENUM");
      if (!en) return [];
      return [en, ...collectClassMethods(node, en.name, ["method_declaration"])];
    }
    default: {
      return [];
    }
  }
}

/** PHP files parse to a `program` root: a `php_tag` node followed by top-level declarations
 * (the `<?php ?>` wrapper is not extra nesting to unwrap, unlike some other embedded-language
 * grammars). */
export function extractSymbolSpansPhp(tree: Tree): SymbolSpan[] {
  const spans: SymbolSpan[] = [];
  for (const child of tree.rootNode.namedChildren) {
    spans.push(...extractFromPhpDeclaration(child));
  }
  return spans;
}
