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

/** Kind of container a METHOD span lives in, used to pick the header's KIND token (buildPrefix). */
export type ContainerKind = "CLASS" | "MODULE";

export interface SymbolSpan {
  kind: SymbolKind;
  name: string;
  className?: string;
  /** Only meaningful when `className` is set; defaults to "CLASS" when omitted. */
  containerKind?: ContainerKind;
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

export function spanFromNode(
  node: Node,
  kind: SymbolKind,
  className?: string,
  containerKind?: ContainerKind,
): SymbolSpan | undefined {
  const name = nodeName(node);
  if (!name) return undefined;
  return {
    kind,
    name,
    ...(className === undefined ? {} : { className }),
    ...(containerKind === undefined ? {} : { containerKind }),
    startIndex: node.startIndex,
    endIndex: node.endIndex,
  };
}

/**
 * Collect METHOD spans from a container node's `body` field.
 * `memberTypes` scopes which body-member node types count as methods
 * (JS/TS: "method_definition"; Java: "method_declaration"; Ruby: "method"/"singleton_method").
 * `containerKind` controls the header's KIND token for these methods (defaults to "CLASS").
 */
export function collectClassMethods(
  classNode: Node,
  className: string,
  memberTypes: readonly string[] = ["method_definition"],
  containerKind?: ContainerKind,
): SymbolSpan[] {
  const body = classNode.childForFieldName("body");
  if (!body) return [];

  const methods: SymbolSpan[] = [];
  for (const member of body.namedChildren) {
    if (!memberTypes.includes(member.type)) continue;
    const span = spanFromNode(member, "METHOD", className, containerKind);
    if (span) methods.push(span);
  }
  return methods;
}
