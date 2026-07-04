import type { Node, Tree } from "web-tree-sitter";
import { declaratorName, spanFromNode, spanFromResolvedName, type SymbolSpan, typedefDeclaratorAlias } from "./tree-sitter-symbols.js";

export function extractFromCDeclaration(node: Node): SymbolSpan[] {
  switch (node.type) {
    case "function_definition": {
      // Name is nested inside a function_declarator, not exposed via a "name" field. No fallback
      // to the generic nodeName heuristic if resolution fails — it would grab the return type.
      const fn = spanFromResolvedName(node, "FUNCTION", declaratorName(node));
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
      // `typedef struct Point Point;` -> alias is a direct `type_identifier` child; a
      // function-pointer typedef (`typedef int (*FuncPtr)(int,int);`) has no such direct child, so
      // typedefDeclaratorAlias descends the function/parenthesized/pointer declarator chain.
      const alias = spanFromResolvedName(node, "TYPE", typedefDeclaratorAlias(node));
      return alias ? [alias] : [];
    }
    case "preproc_ifdef": {
      // #ifdef/#ifndef-guarded top-level declarations (e.g. a feature-flagged function) — recurse
      // into the guarded members as if they were ordinary top-level declarations, so they get
      // named spans too (residue coverage already guarantees their text isn't dropped either way).
      const spans: SymbolSpan[] = [];
      for (const child of node.namedChildren) {
        spans.push(...extractFromCDeclaration(child));
      }
      return spans;
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
