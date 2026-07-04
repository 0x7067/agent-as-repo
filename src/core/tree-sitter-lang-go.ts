import type { Node, Tree } from "web-tree-sitter";
import { spanFromNode, type SymbolSpan } from "./tree-sitter-symbols.js";

function goTypeName(node: Node): string | undefined {
  if (node.type === "pointer_type") {
    const inner = node.namedChildren.at(0);
    return inner ? goTypeName(inner) : undefined;
  }
  const text = node.text;
  return text.length > 0 ? text : undefined;
}

/** Best-effort extraction of the receiver's type name, e.g. `func (s *Server) Foo()` -> "Server". */
function goReceiverClassName(methodNode: Node): string | undefined {
  const receiver = methodNode.childForFieldName("receiver");
  const param = receiver?.namedChildren.at(0);
  const type = param?.childForFieldName("type");
  return type ? goTypeName(type) : undefined;
}

/** A `type_declaration` can hold multiple `type_spec`s; emit one TYPE span per spec. */
function collectGoTypeSpecs(declNode: Node): SymbolSpan[] {
  const spans: SymbolSpan[] = [];
  for (const specNode of declNode.namedChildren) {
    if (specNode.type !== "type_spec") continue;
    const name = specNode.childForFieldName("name")?.text;
    if (!name) continue;
    spans.push({ kind: "TYPE", name, startIndex: declNode.startIndex, endIndex: declNode.endIndex });
  }
  return spans;
}

function extractFromGoDeclaration(node: Node): SymbolSpan[] {
  switch (node.type) {
    case "function_declaration": {
      const fn = spanFromNode(node, "FUNCTION");
      return fn ? [fn] : [];
    }
    case "method_declaration": {
      const className = goReceiverClassName(node);
      const method = className
        ? spanFromNode(node, "METHOD", className)
        : spanFromNode(node, "FUNCTION");
      return method ? [method] : [];
    }
    case "type_declaration": {
      return collectGoTypeSpecs(node);
    }
    default: {
      return [];
    }
  }
}

export function extractSymbolSpansGo(tree: Tree): SymbolSpan[] {
  const spans: SymbolSpan[] = [];
  for (const child of tree.rootNode.namedChildren) {
    spans.push(...extractFromGoDeclaration(child));
  }
  return spans;
}
