import type { Node, Tree } from "web-tree-sitter";
import { collectClassMethods, spanFromNode, type SymbolSpan } from "./tree-sitter-symbols.js";

/** Rust impl blocks are unnamed (or named only by the type they implement); extract their
 * `function_item` children as METHOD spans with `className` = the impl'd type's text, and skip a
 * span for the impl block itself. */
function extractRustImplMethods(implNode: Node): SymbolSpan[] {
  const typeNode = implNode.childForFieldName("type");
  const className = typeNode?.text;
  if (!className) return [];
  return collectClassMethods(implNode, className, ["function_item"]);
}

function extractFromRustDeclaration(node: Node): SymbolSpan[] {
  switch (node.type) {
    case "function_item": {
      const fn = spanFromNode(node, "FUNCTION");
      return fn ? [fn] : [];
    }
    case "struct_item": {
      const struct = spanFromNode(node, "STRUCT");
      return struct ? [struct] : [];
    }
    case "enum_item": {
      const en = spanFromNode(node, "ENUM");
      return en ? [en] : [];
    }
    case "trait_item": {
      const trait = spanFromNode(node, "TRAIT");
      return trait ? [trait] : [];
    }
    case "type_item": {
      const alias = spanFromNode(node, "TYPE");
      return alias ? [alias] : [];
    }
    case "mod_item": {
      const mod = spanFromNode(node, "MODULE");
      if (!mod) return [];
      return [mod, ...collectClassMethods(node, mod.name, ["function_item"], "MODULE")];
    }
    case "impl_item": {
      return extractRustImplMethods(node);
    }
    default: {
      return [];
    }
  }
}

export function extractSymbolSpansRust(tree: Tree): SymbolSpan[] {
  const spans: SymbolSpan[] = [];
  for (const child of tree.rootNode.namedChildren) {
    spans.push(...extractFromRustDeclaration(child));
  }
  return spans;
}
