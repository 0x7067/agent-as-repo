import type { Node, Tree } from "web-tree-sitter";
import { spanFromNode, spanFromResolvedName, type SymbolKind, type SymbolSpan } from "./tree-sitter-symbols.js";

/**
 * `class_declaration` covers class/struct/enum/extension/actor alike (all five share the exact
 * same node type), distinguished only by the unnamed `declaration_kind` field token — see
 * node-types.json. `extension`/`actor`/plain `class` all map to CLASS; `struct`/`enum` get their
 * own SymbolKind since the field makes that trivially readable.
 */
const DECLARATION_KIND_TO_SYMBOL_KIND: Record<string, SymbolKind> = {
  class: "CLASS",
  actor: "CLASS",
  extension: "CLASS",
  struct: "STRUCT",
  enum: "ENUM",
};

const MEMBER_DECLARATION_TYPES = new Set(["function_declaration", "init_declaration", "deinit_declaration"]);

/**
 * Collect METHOD spans from a class/struct/enum/extension/actor's `body` (`class_body` or
 * `enum_class_body` — both accept the same member node types per node-types.json).
 * `init_declaration`'s `name` field resolves to the literal `init` token, so `spanFromNode`'s
 * ordinary name lookup already gives the right text. `deinit_declaration` has no `name` field and
 * no identifier child at all, so its name is hardcoded via `spanFromResolvedName`.
 */
function collectSwiftMembers(body: Node | undefined, className: string): SymbolSpan[] {
  if (!body) return [];

  const methods: SymbolSpan[] = [];
  for (const member of body.namedChildren) {
    if (!MEMBER_DECLARATION_TYPES.has(member.type)) continue;
    const span =
      member.type === "deinit_declaration"
        ? spanFromResolvedName(member, "METHOD", "deinit", className)
        : spanFromNode(member, "METHOD", className);
    if (span) methods.push(span);
  }
  return methods;
}

function extractFromSwiftDeclaration(node: Node): SymbolSpan[] {
  switch (node.type) {
    case "function_declaration": {
      const fn = spanFromNode(node, "FUNCTION");
      return fn ? [fn] : [];
    }
    case "class_declaration": {
      const kindToken = node.childForFieldName("declaration_kind")?.type;
      const kind = (kindToken ? DECLARATION_KIND_TO_SYMBOL_KIND[kindToken] : undefined) ?? "CLASS";
      const decl = spanFromNode(node, kind);
      if (!decl) return [];
      return [decl, ...collectSwiftMembers(node.childForFieldName("body") ?? undefined, decl.name)];
    }
    case "protocol_declaration": {
      const iface = spanFromNode(node, "INTERFACE");
      return iface ? [iface] : [];
    }
    default: {
      return [];
    }
  }
}

export function extractSymbolSpansSwift(tree: Tree): SymbolSpan[] {
  const spans: SymbolSpan[] = [];
  for (const child of tree.rootNode.namedChildren) {
    spans.push(...extractFromSwiftDeclaration(child));
  }
  return spans;
}
