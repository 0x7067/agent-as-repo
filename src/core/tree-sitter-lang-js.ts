import type { Node, Tree } from "web-tree-sitter";
import { spanFromNode, type SymbolSpan } from "./tree-sitter-symbols.js";

function collectConstArrows(node: Node): SymbolSpan[] {
  const spans: SymbolSpan[] = [];
  for (const declarator of node.namedChildren) {
    if (declarator.type !== "variable_declarator") continue;
    const value = declarator.childForFieldName("value");
    if (!value?.text.includes("=>")) continue;
    const span = spanFromNode(declarator, "CONST");
    if (span) spans.push(span);
  }
  return spans;
}

function collectClassMethods(classNode: Node, className: string): SymbolSpan[] {
  const body = classNode.childForFieldName("body");
  if (!body) return [];

  const methods: SymbolSpan[] = [];
  for (const member of body.namedChildren) {
    if (member.type !== "method_definition") continue;
    const span = spanFromNode(member, "METHOD", className);
    if (span) methods.push(span);
  }
  return methods;
}

function extractFromDeclaration(node: Node): SymbolSpan[] {
  switch (node.type) {
    case "function_declaration":
    case "generator_function_declaration": {
      const fn = spanFromNode(node, "FUNCTION");
      return fn ? [fn] : [];
    }
    case "class_declaration": {
      const cls = spanFromNode(node, "CLASS");
      if (!cls) return [];
      return [cls, ...collectClassMethods(node, cls.name)];
    }
    case "interface_declaration": {
      const iface = spanFromNode(node, "INTERFACE");
      return iface ? [iface] : [];
    }
    case "type_alias_declaration": {
      const alias = spanFromNode(node, "TYPE");
      return alias ? [alias] : [];
    }
    case "lexical_declaration":
    case "variable_declaration": {
      return collectConstArrows(node);
    }
    default: {
      return [];
    }
  }
}

/** Extract definition spans from a JS/TS/TSX tree-sitter AST. */
export function extractSymbolSpansJsTs(tree: Tree): SymbolSpan[] {
  const spans: SymbolSpan[] = [];

  for (const child of tree.rootNode.namedChildren) {
    if (child.type === "export_statement") {
      const declaration = child.namedChildren.find((node) =>
        node.type === "function_declaration"
        || node.type === "class_declaration"
        || node.type === "interface_declaration"
        || node.type === "type_alias_declaration"
        || node.type === "lexical_declaration"
        || node.type === "variable_declaration",
      );
      if (declaration) {
        spans.push(...extractFromDeclaration(declaration));
        continue;
      }
      if (child.text.includes("=>")) {
        const match = /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(child.text);
        const exportedName = match?.[1];
        if (exportedName) {
          spans.push({
            kind: "CONST",
            name: exportedName,
            startIndex: child.startIndex,
            endIndex: child.endIndex,
          });
        }
      }
      continue;
    }

    spans.push(...extractFromDeclaration(child));
  }

  return spans;
}
