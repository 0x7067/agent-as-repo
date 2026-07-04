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

/** Build a `SymbolSpan` from an already-resolved `name`, or `undefined` when `name` is falsy. */
function buildSpan(
  node: Node,
  kind: SymbolKind,
  name: string | undefined,
  className?: string,
  containerKind?: ContainerKind,
): SymbolSpan | undefined {
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

/** Build a span for `node`, resolving its name via `nodeName(node)`. */
export function spanFromNode(
  node: Node,
  kind: SymbolKind,
  className?: string,
  containerKind?: ContainerKind,
): SymbolSpan | undefined {
  return buildSpan(node, kind, nodeName(node), className, containerKind);
}

/**
 * Build a span for `node` using an already-resolved `name`, with NO fallback to `nodeName(node)`.
 * For callers whose grammar buries the name somewhere `nodeName` can't reach (e.g. C/C++
 * declarator chains via `declaratorName`) and where falling back to `nodeName`'s generic
 * heuristic would be actively misleading (e.g. it would grab a C++ function's *return type*
 * instead of its name) rather than merely incomplete. When `name` resolution fails, this returns
 * `undefined` — no span, no misleading name — leaving the content to residue coverage.
 */
export function spanFromResolvedName(
  node: Node,
  kind: SymbolKind,
  name: string | undefined,
  className?: string,
  containerKind?: ContainerKind,
): SymbolSpan | undefined {
  return buildSpan(node, kind, name, className, containerKind);
}

const DECLARATOR_NAME_LEAF_TYPES: readonly string[] = [
  "identifier",
  "field_identifier",
  "qualified_identifier",
  "operator_name",
  "destructor_name",
];

/**
 * Descend a declarator chain looking for a leaf node whose type is in `leafTypes`. Grammars nest
 * declarators two ways: via a `declarator` field (function/pointer/reference/array declarators),
 * and — for `parenthesized_declarator` nodes, used e.g. by function-pointer typedefs — by wrapping
 * the inner declarator as an ordinary (non-field) child instead.
 */
function descendDeclarator(node: Node, leafTypes: readonly string[]): string | undefined {
  let current: Node | undefined = node;
  while (current) {
    if (leafTypes.includes(current.type)) {
      const text = current.text;
      return text.length > 0 ? text : undefined;
    }
    current =
      current.childForFieldName("declarator")
      ?? (current.type === "parenthesized_declarator" ? current.namedChildren[0] : undefined);
  }
  return undefined;
}

/**
 * Resolve the identifier name buried inside a C/C++ `declarator` chain.
 * A function's name is not exposed via a `name` field the way most grammars do it — it's nested
 * inside `function_declarator` (itself possibly wrapped in `pointer_declarator`/`reference_declarator`
 * for pointer/reference return types). Descend the `declarator` field chain until a leaf is found:
 * a plain `identifier` (C), a `field_identifier` (in-class C++ methods), a `qualified_identifier`
 * (out-of-class C++ definitions like `Foo::bar`/`Foo::Foo`/`Foo::~Foo` — its own text already is
 * the qualified name), an `operator_name` (`operator+`), or a `destructor_name` (`~Foo`).
 */
export function declaratorName(node: Node): string | undefined {
  return descendDeclarator(node, DECLARATOR_NAME_LEAF_TYPES);
}

/**
 * Resolve a typedef's alias identifier, descending through function-pointer declarator chains
 * (`function_declarator` / `parenthesized_declarator` / `pointer_declarator`) when the alias isn't
 * a direct `type_identifier` child of the `type_definition` node (e.g. `typedef int (*FuncPtr)(int,int);`).
 */
export function typedefDeclaratorAlias(node: Node): string | undefined {
  return descendDeclarator(node, ["type_identifier"]);
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
    const span = spanFromResolvedName(member, "METHOD", declaratorName(member), className);
    if (span) methods.push(span);
  }
  return methods;
}
