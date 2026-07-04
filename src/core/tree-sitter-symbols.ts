import type { Node } from "web-tree-sitter";

/** Kinds of source symbols tree-sitter chunking can extract a span for. */
export type SymbolKind =
  | "FUNCTION"
  | "CLASS"
  | "INTERFACE"
  | "TYPE"
  | "CONST"
  | "METHOD"
  | "ENUM"
  | "MODULE";

export interface SymbolSpan {
  kind: SymbolKind;
  name: string;
  className?: string;
  startIndex: number;
  endIndex: number;
}

/** Resolve a declaration's name: prefer the grammar's `name` field, else the first plausible identifier child. */
export function nodeName(node: Node): string | undefined {
  const nameNode =
    node.childForFieldName("name")
    ?? node.namedChildren.find((child) =>
      child.type === "identifier" || child.type === "type_identifier" || child.type === "constant");
  if (!nameNode) return undefined;
  const text = nameNode.text;
  return text.length > 0 ? text : undefined;
}

export function spanFromNode(node: Node, kind: SymbolKind, className?: string): SymbolSpan | undefined {
  const name = nodeName(node);
  if (!name) return undefined;
  return {
    kind,
    name,
    ...(className === undefined ? {} : { className }),
    startIndex: node.startIndex,
    endIndex: node.endIndex,
  };
}

/**
 * Collect METHOD spans from a container node's `body` field.
 * `memberTypes` scopes which body-member node types count as methods
 * (JS/TS: "method_definition"; Java: "method_declaration"; Ruby: "method"/"singleton_method").
 */
export function collectClassMethods(
  classNode: Node,
  className: string,
  memberTypes: readonly string[] = ["method_definition"],
): SymbolSpan[] {
  const body = classNode.childForFieldName("body");
  if (!body) return [];

  const methods: SymbolSpan[] = [];
  for (const member of body.namedChildren) {
    if (!memberTypes.includes(member.type)) continue;
    const span = spanFromNode(member, "METHOD", className);
    if (span) methods.push(span);
  }
  return methods;
}
