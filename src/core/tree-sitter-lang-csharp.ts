import type { Node, Tree } from "web-tree-sitter";
import { collectClassMethods, spanFromNode, type SymbolSpan } from "./tree-sitter-symbols.js";

function extractClassLike(node: Node, kind: "CLASS" | "STRUCT"): SymbolSpan[] {
  const span = spanFromNode(node, kind);
  if (!span) return [];
  return [span, ...collectClassMethods(node, span.name, ["method_declaration"])];
}

/** Recurse into a (block-scoped) namespace's members, same policy as C++: no span for the
 * namespace itself, its members are extracted as if they were top-level declarations. */
function extractFromNamespace(node: Node): SymbolSpan[] {
  const body = node.childForFieldName("body");
  if (!body) return [];
  const spans: SymbolSpan[] = [];
  for (const member of body.namedChildren) {
    spans.push(...extractFromCsharpDeclaration(member));
  }
  return spans;
}

function extractFromCsharpDeclaration(node: Node): SymbolSpan[] {
  switch (node.type) {
    case "class_declaration":
    case "record_declaration": {
      return extractClassLike(node, "CLASS");
    }
    case "struct_declaration": {
      return extractClassLike(node, "STRUCT");
    }
    case "interface_declaration": {
      const iface = spanFromNode(node, "INTERFACE");
      return iface ? [iface] : [];
    }
    case "enum_declaration": {
      const en = spanFromNode(node, "ENUM");
      return en ? [en] : [];
    }
    case "namespace_declaration": {
      return extractFromNamespace(node);
    }
    case "file_scoped_namespace_declaration": {
      // `namespace Foo;` has no body — its "members" are just the remaining top-level siblings in
      // the compilation unit, already reached by the caller's own top-level iteration. Nothing to
      // recurse into and no useful span to emit for the declaration itself.
      return [];
    }
    default: {
      return [];
    }
  }
}

export function extractSymbolSpansCsharp(tree: Tree): SymbolSpan[] {
  const spans: SymbolSpan[] = [];
  for (const child of tree.rootNode.namedChildren) {
    spans.push(...extractFromCsharpDeclaration(child));
  }
  return spans;
}
