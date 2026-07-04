import type { Node, Tree } from "web-tree-sitter";
import { extractFromCDeclaration } from "./tree-sitter-lang-c.js";
import { collectDeclaratorMethods, spanFromNode, type SymbolSpan } from "./tree-sitter-symbols.js";

const TEMPLATE_INNER_TYPES = new Set(["class_specifier", "struct_specifier", "function_definition"]);

function extractClassOrStruct(node: Node, kind: "CLASS" | "STRUCT"): SymbolSpan[] {
  const container = spanFromNode(node, kind);
  if (!container) return [];
  return [container, ...collectDeclaratorMethods(node, container.name)];
}

/** Unwrap a `template_declaration` to its inner class/struct/function, then re-run extraction on
 * that inner node so it's handled exactly like a non-templated declaration would be — except the
 * outer symbol's own span is widened back out to `template <...>` (only the first span returned
 * needs it; nested METHOD spans keep their real, un-widened positions). */
function extractFromTemplate(node: Node): SymbolSpan[] {
  const inner = node.namedChildren.find((child) => TEMPLATE_INNER_TYPES.has(child.type));
  if (!inner) return [];
  const spans = extractFromCppDeclaration(inner);
  const first = spans.at(0);
  if (!first) return [];
  return [{ ...first, startIndex: node.startIndex }, ...spans.slice(1)];
}

/** Recurse into a namespace body's members, treating them like top-level declarations. No span is
 * emitted for the namespace itself, so a namespace wrapping the whole file never becomes one giant
 * chunk — its members are extracted individually instead. */
function extractFromNamespace(node: Node): SymbolSpan[] {
  const body = node.childForFieldName("body");
  if (!body) return [];
  const spans: SymbolSpan[] = [];
  for (const member of body.namedChildren) {
    spans.push(...extractFromCppDeclaration(member));
  }
  return spans;
}

function extractFromCppDeclaration(node: Node): SymbolSpan[] {
  switch (node.type) {
    case "class_specifier": {
      return extractClassOrStruct(node, "CLASS");
    }
    case "struct_specifier": {
      if (!node.childForFieldName("body")) return [];
      return extractClassOrStruct(node, "STRUCT");
    }
    case "namespace_definition": {
      return extractFromNamespace(node);
    }
    case "template_declaration": {
      return extractFromTemplate(node);
    }
    default: {
      return extractFromCDeclaration(node);
    }
  }
}

export function extractSymbolSpansCpp(tree: Tree): SymbolSpan[] {
  const spans: SymbolSpan[] = [];
  for (const child of tree.rootNode.namedChildren) {
    spans.push(...extractFromCppDeclaration(child));
  }
  return spans;
}
