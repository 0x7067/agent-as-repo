import type { Node, Tree } from "web-tree-sitter";
import { nodeName, type SymbolKind, type SymbolSpan } from "./tree-sitter-symbols.js";

/**
 * Unwrap a `decorated_definition` to the inner `function_definition`/`class_definition`,
 * while keeping the outer node so the span covers the decorator(s) too.
 */
function unwrapPythonDefinition(node: Node): { def: Node; span: Node } | undefined {
  if (node.type === "decorated_definition") {
    const inner = node.childForFieldName("definition");
    if (!inner) return undefined;
    return { def: inner, span: node };
  }
  if (node.type === "function_definition" || node.type === "class_definition") {
    return { def: node, span: node };
  }
  return undefined;
}

function pythonSymbolFromStatement(node: Node, className?: string): SymbolSpan | undefined {
  const unwrapped = unwrapPythonDefinition(node);
  if (!unwrapped) return undefined;
  const { def, span } = unwrapped;
  const name = nodeName(def);
  if (!name) return undefined;

  let kind: SymbolKind;
  if (def.type === "class_definition") {
    kind = "CLASS";
  } else if (className) {
    kind = "METHOD";
  } else {
    kind = "FUNCTION";
  }

  return {
    kind,
    name,
    ...(className === undefined ? {} : { className }),
    startIndex: span.startIndex,
    endIndex: span.endIndex,
  };
}

function collectPythonMethods(classDef: Node, className: string): SymbolSpan[] {
  const body = classDef.childForFieldName("body");
  if (!body) return [];

  const methods: SymbolSpan[] = [];
  for (const member of body.namedChildren) {
    const unwrapped = unwrapPythonDefinition(member);
    if (!unwrapped || unwrapped.def.type !== "function_definition") continue;
    const span = pythonSymbolFromStatement(member, className);
    if (span) methods.push(span);
  }
  return methods;
}

export function extractSymbolSpansPython(tree: Tree): SymbolSpan[] {
  const spans: SymbolSpan[] = [];

  for (const child of tree.rootNode.namedChildren) {
    const unwrapped = unwrapPythonDefinition(child);
    if (!unwrapped) continue;

    if (unwrapped.def.type === "class_definition") {
      const cls = pythonSymbolFromStatement(child);
      if (!cls) continue;
      spans.push(cls, ...collectPythonMethods(unwrapped.def, cls.name));
    } else {
      const fn = pythonSymbolFromStatement(child);
      if (fn) spans.push(fn);
    }
  }

  return spans;
}
