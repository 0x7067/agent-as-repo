import type { Node, Tree } from "web-tree-sitter";
import { collectClassMethods, spanFromNode, type SymbolSpan } from "./tree-sitter-symbols.js";

const RUBY_METHOD_TYPES = ["method", "singleton_method"] as const;

function extractFromRubyDeclaration(node: Node): SymbolSpan[] {
  switch (node.type) {
    case "method": {
      const fn = spanFromNode(node, "FUNCTION");
      return fn ? [fn] : [];
    }
    case "class": {
      const cls = spanFromNode(node, "CLASS");
      if (!cls) return [];
      return [cls, ...collectClassMethods(node, cls.name, RUBY_METHOD_TYPES)];
    }
    case "module": {
      const mod = spanFromNode(node, "MODULE");
      if (!mod) return [];
      return [mod, ...collectClassMethods(node, mod.name, RUBY_METHOD_TYPES)];
    }
    default: {
      return [];
    }
  }
}

export function extractSymbolSpansRuby(tree: Tree): SymbolSpan[] {
  const spans: SymbolSpan[] = [];
  for (const child of tree.rootNode.namedChildren) {
    spans.push(...extractFromRubyDeclaration(child));
  }
  return spans;
}
