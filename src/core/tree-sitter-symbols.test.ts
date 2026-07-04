import { Language, Parser, type Tree } from "web-tree-sitter";
import { beforeAll, describe, expect, it } from "vitest";
import { collectClassMethods, nodeName, spanFromNode } from "./tree-sitter-symbols.js";
import { GRAMMAR_WASM_BY_LABEL, WEB_TREE_SITTER_WASM } from "./tree-sitter-test-paths.js";

// These are pure functions over web-tree-sitter Node objects, so a real (but minimal) parsed
// tree is the simplest way to exercise them directly, without going through the full
// treeSitterStrategy dispatch. JavaScript is used as a convenient, already-wired grammar.

let parser: Parser;

beforeAll(async () => {
  await Parser.init({ locateFile: () => WEB_TREE_SITTER_WASM });
  parser = new Parser();
  const language = await Language.load(GRAMMAR_WASM_BY_LABEL.javascript);
  parser.setLanguage(language);
});

function parse(source: string): Tree {
  const tree = parser.parse(source);
  if (!tree) throw new Error("parse failed");
  return tree;
}

describe("nodeName", () => {
  it("resolves a declaration's name via the grammar's name field", () => {
    const tree = parse("function foo() {}");
    const fn = tree.rootNode.namedChild(0);
    expect(fn && nodeName(fn)).toBe("foo");
  });

  it("returns undefined when no plausible name child exists", () => {
    const tree = parse("1 + 1;");
    const expr = tree.rootNode.namedChild(0);
    expect(expr && nodeName(expr)).toBeUndefined();
  });
});

describe("spanFromNode", () => {
  it("builds a span with kind, name, and the node's index range", () => {
    const tree = parse("function foo() {}");
    const fn = tree.rootNode.namedChild(0);
    const span = fn ? spanFromNode(fn, "FUNCTION") : undefined;
    expect(span).toEqual({ kind: "FUNCTION", name: "foo", startIndex: 0, endIndex: 17 });
  });

  it("includes className and containerKind only when provided (exactOptionalPropertyTypes-safe)", () => {
    const tree = parse("class Foo { bar() {} }");
    const classNode = tree.rootNode.namedChild(0);
    const body = classNode?.childForFieldName("body");
    const method = body?.namedChild(0);
    const span = method ? spanFromNode(method, "METHOD", "Foo", "MODULE") : undefined;
    expect(span?.className).toBe("Foo");
    expect(span?.containerKind).toBe("MODULE");
  });

  it("returns undefined when the node has no resolvable name", () => {
    const tree = parse("1 + 1;");
    const expr = tree.rootNode.namedChild(0);
    expect(expr && spanFromNode(expr, "FUNCTION")).toBeUndefined();
  });
});

describe("collectClassMethods", () => {
  it("collects METHOD spans scoped by memberTypes from the container's body", () => {
    const tree = parse("class Foo {\n  bar() {}\n  baz() {}\n}");
    const classNode = tree.rootNode.namedChild(0);
    const methods = classNode ? collectClassMethods(classNode, "Foo") : [];
    expect(methods.map((m) => m.name)).toEqual(["bar", "baz"]);
    expect(methods.every((m) => m.className === "Foo")).toBe(true);
  });

  it("returns an empty array when the container has no body", () => {
    const tree = parse("1 + 1;");
    const expr = tree.rootNode.namedChild(0);
    expect(expr && collectClassMethods(expr, "N/A")).toEqual([]);
  });

  it("tags collected methods with the given containerKind", () => {
    const tree = parse("class Greeter {\n  hello() {}\n}");
    const classNode = tree.rootNode.namedChild(0);
    const methods = classNode ? collectClassMethods(classNode, "Greeter", ["method_definition"], "MODULE") : [];
    expect(methods).toHaveLength(1);
    expect(methods[0]?.containerKind).toBe("MODULE");
  });
});
