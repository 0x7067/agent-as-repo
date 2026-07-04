import { Language, Parser, type Tree } from "web-tree-sitter";
import { beforeAll, describe, expect, it } from "vitest";
import { collectClassMethods, declaratorName, nodeName, spanFromNode, spanFromResolvedName } from "./tree-sitter-symbols.js";
import { GRAMMAR_WASM_BY_LABEL, WEB_TREE_SITTER_WASM } from "./tree-sitter-test-paths.js";

// These are pure functions over web-tree-sitter Node objects, so a real (but minimal) parsed
// tree is the simplest way to exercise them directly, without going through the full
// treeSitterStrategy dispatch. JavaScript is used as a convenient, already-wired grammar.

let parser: Parser;
let cppParser: Parser;

beforeAll(async () => {
  await Parser.init({ locateFile: () => WEB_TREE_SITTER_WASM });
  parser = new Parser();
  const language = await Language.load(GRAMMAR_WASM_BY_LABEL.javascript);
  parser.setLanguage(language);

  cppParser = new Parser();
  const cppLanguage = await Language.load(GRAMMAR_WASM_BY_LABEL.cpp);
  cppParser.setLanguage(cppLanguage);
});

function parse(source: string): Tree {
  const tree = parser.parse(source);
  if (!tree) throw new Error("parse failed");
  return tree;
}

function parseCpp(source: string): Tree {
  const tree = cppParser.parse(source);
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

describe("declaratorName", () => {
  it("resolves a qualified_identifier declarator (out-of-class C++ method) to its full text", () => {
    const tree = parseCpp("void Foo::bar() {}");
    const fn = tree.rootNode.namedChild(0);
    expect(fn && declaratorName(fn)).toBe("Foo::bar");
  });

  it("resolves a qualified_identifier declarator wrapping a destructor_name to its full text", () => {
    const tree = parseCpp("Foo::~Foo() {}");
    const fn = tree.rootNode.namedChild(0);
    expect(fn && declaratorName(fn)).toBe("Foo::~Foo");
  });

  it("resolves an in-class destructor_name declarator directly", () => {
    const tree = parseCpp("class Foo { ~Foo() {} };");
    const classNode = tree.rootNode.namedChild(0);
    const body = classNode?.childForFieldName("body");
    const method = body?.namedChildren.find((child) => child.type === "function_definition");
    expect(method && declaratorName(method)).toBe("~Foo");
  });

  it("resolves an operator_name declarator (top-level operator overload) to its text", () => {
    const tree = parseCpp("Foo operator+(const Foo& a, const Foo& b) { return a; }");
    const fn = tree.rootNode.namedChild(0);
    expect(fn && declaratorName(fn)).toBe("operator+");
  });

  it("still resolves a plain identifier declarator (unaffected by the new leaf types)", () => {
    const tree = parseCpp("int add(int a, int b) { return a + b; }");
    const fn = tree.rootNode.namedChild(0);
    expect(fn && declaratorName(fn)).toBe("add");
  });
});

describe("spanFromResolvedName", () => {
  it("builds a span using the given name, without consulting nodeName at all", () => {
    // `void Foo::bar() {}` — nodeName(node) would resolve nothing useful here (no "name" field,
    // no plain identifier/type_identifier/constant child at the top level); spanFromResolvedName
    // must use exactly the name it's given.
    const tree = parseCpp("void Foo::bar() {}");
    const fn = tree.rootNode.namedChild(0);
    const span = fn ? spanFromResolvedName(fn, "FUNCTION", declaratorName(fn)) : undefined;
    expect(span?.name).toBe("Foo::bar");
  });

  it("returns undefined (no span, no fallback name) when the resolved name is undefined", () => {
    // This is the fix for the misleading-fallback bug: previously, spanFromNode's `resolvedName
    // ?? nodeName(node)` fell back to the generic heuristic (which grabbed the return type "Foo")
    // when declarator-based resolution failed. spanFromResolvedName must emit no span instead.
    const tree = parseCpp("Foo operator+(const Foo& a, const Foo& b) { return a; }");
    const fn = tree.rootNode.namedChild(0);
    const brokenResolution: string | undefined = undefined;
    const span = fn ? spanFromResolvedName(fn, "FUNCTION", brokenResolution) : undefined;
    expect(span).toBeUndefined();
    // Sanity: nodeName(node) *would* have resolved to the misleading "Foo" (the return type) —
    // proving this test actually exercises the no-fallback guarantee, not a vacuous case.
    expect(fn && nodeName(fn)).toBe("Foo");
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
