import type { Node, Tree } from "web-tree-sitter";
import { spanFromNode, spanFromResolvedName, type ContainerKind, type SymbolSpan } from "./tree-sitter-symbols.js";

/**
 * The fwcd Kotlin grammar exposes *no* named fields at all on `function_declaration` (or
 * `class_declaration`/`object_declaration` — see node-types.json), so every name and body must be
 * found by scanning namedChildren by node type instead of the usual `childForFieldName`.
 *
 * Function/property names are `simple_identifier` nodes — a different node type than the
 * `type_identifier` the shared `nodeName()` helper already knows to look for (that one still
 * resolves class/object/type-alias names fine, since those use `type_identifier`). Kept local
 * rather than widening the shared helper: `simple_identifier` is Kotlin/Swift-grammar-specific
 * terminology that other languages' grammars don't use, so there's no shared benefit to it.
 */
function kotlinFunctionName(node: Node): string | undefined {
  const nameNode = node.namedChildren.find((child) => child.type === "simple_identifier");
  return nameNode && nameNode.text.length > 0 ? nameNode.text : undefined;
}

/**
 * The fwcd Kotlin grammar has no `body` field on `class_declaration`/`object_declaration` (it
 * doesn't expose *any* named fields for these node types — see node-types.json), so a member
 * container's body must be found by scanning namedChildren for the `class_body`/`enum_class_body`
 * node type instead of the usual `childForFieldName("body")`.
 */
function findBody(node: Node): Node | undefined {
  return node.namedChildren.find((child) => child.type === "class_body" || child.type === "enum_class_body");
}

function methodSpanFromFunctionDeclaration(
  node: Node,
  containerName: string,
  containerKind?: ContainerKind,
): SymbolSpan | undefined {
  return spanFromResolvedName(node, "METHOD", kotlinFunctionName(node), containerName, containerKind);
}

/** `function_declaration` members directly inside a `class_body`/`enum_class_body`, as METHOD spans. */
function collectDirectMembers(body: Node, containerName: string, containerKind?: ContainerKind): SymbolSpan[] {
  return body.namedChildren
    .filter((member) => member.type === "function_declaration")
    .map((member) => methodSpanFromFunctionDeclaration(member, containerName, containerKind))
    .filter((span): span is SymbolSpan => span !== undefined);
}

/**
 * A class's `companion_object` member nests its own `function_declaration`s one level deeper than
 * ordinary members. Companion-object functions act like static members of the class, so they're
 * flattened into the same METHOD list under the containing class's name rather than getting their
 * own container span.
 */
function collectCompanionMembers(body: Node, containerName: string, containerKind?: ContainerKind): SymbolSpan[] {
  const companion = body.namedChildren.find((member) => member.type === "companion_object");
  const companionBody = companion && findBody(companion);
  if (!companionBody) return [];
  return collectDirectMembers(companionBody, containerName, containerKind);
}

/** Collect METHOD spans from a class/object's `class_body` (including its companion object's, if any). */
function collectKotlinMembers(containerNode: Node, containerName: string, containerKind?: ContainerKind): SymbolSpan[] {
  const body = findBody(containerNode);
  if (!body) return [];
  return [
    ...collectDirectMembers(body, containerName, containerKind),
    ...collectCompanionMembers(body, containerName, containerKind),
  ];
}

function extractFromKotlinDeclaration(node: Node): SymbolSpan[] {
  switch (node.type) {
    case "function_declaration": {
      const fn = spanFromResolvedName(node, "FUNCTION", kotlinFunctionName(node));
      return fn ? [fn] : [];
    }
    case "class_declaration": {
      // Covers both `class` and `interface` — the grammar has no separate interface_declaration
      // node type (interfaces parse identically to classes; ~61% structural fidelity, see the
      // Slice 3 research doc).
      const cls = spanFromNode(node, "CLASS");
      if (!cls) return [];
      return [cls, ...collectKotlinMembers(node, cls.name, "CLASS")];
    }
    case "object_declaration": {
      // A Kotlin `object` is a singleton — MODULE fits better than CLASS.
      const mod = spanFromNode(node, "MODULE");
      if (!mod) return [];
      return [mod, ...collectKotlinMembers(node, mod.name, "MODULE")];
    }
    case "type_alias": {
      const alias = spanFromNode(node, "TYPE");
      return alias ? [alias] : [];
    }
    default: {
      // Top-level `property_declaration` (val/var/const) is intentionally not extracted as its own
      // span — residue coverage still chunks it, and most top-level Kotlin properties aren't
      // interesting enough on their own to warrant a CONST header.
      return [];
    }
  }
}

export function extractSymbolSpansKotlin(tree: Tree): SymbolSpan[] {
  const spans: SymbolSpan[] = [];
  for (const child of tree.rootNode.namedChildren) {
    spans.push(...extractFromKotlinDeclaration(child));
  }
  return spans;
}
