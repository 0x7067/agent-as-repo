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
  | "MODULE"
  | "STRUCT"
  | "TRAIT";

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

/**
 * Build a span for `node`. Name resolution defaults to `nodeName(node)`, but callers whose
 * grammar buries the name somewhere `nodeName` can't reach (e.g. C/C++ declarator chains) can
 * pass an already-resolved `resolvedName` to use instead.
 */
export function spanFromNode(
  node: Node,
  kind: SymbolKind,
  className?: string,
  containerKind?: ContainerKind,
  resolvedName?: string,
): SymbolSpan | undefined {
  const name = resolvedName ?? nodeName(node);
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
 * Resolve the identifier name buried inside a C/C++ `declarator` chain.
 * A function's name is not exposed via a `name` field the way most grammars do it — it's nested
 * inside `function_declarator` (itself possibly wrapped in `pointer_declarator`/`reference_declarator`
 * for pointer/reference return types). Descend the `declarator` field chain until an `identifier`
 * or `field_identifier` (C++ method names) leaf is found.
 */
export function declaratorName(node: Node): string | undefined {
  let current: Node | undefined = node;
  while (current) {
    if (current.type === "identifier" || current.type === "field_identifier") {
      const text = current.text;
      return text.length > 0 ? text : undefined;
    }
    current = current.childForFieldName("declarator") ?? undefined;
  }
  return undefined;
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

/**
 * Like `collectClassMethods`, but for grammars (C/C++) where a member's name isn't reachable via
 * `nodeName` and must be resolved with `declaratorName` instead (methods are `function_definition`
 * nodes whose name is nested inside a `function_declarator`).
 */
export function collectDeclaratorMethods(
  containerNode: Node,
  className: string,
  memberTypes: readonly string[] = ["function_definition"],
): SymbolSpan[] {
  const body = containerNode.childForFieldName("body");
  if (!body) return [];

  const methods: SymbolSpan[] = [];
  for (const member of body.namedChildren) {
    if (!memberTypes.includes(member.type)) continue;
    const span = spanFromNode(member, "METHOD", className, undefined, declaratorName(member));
    if (span) methods.push(span);
  }
  return methods;
}
