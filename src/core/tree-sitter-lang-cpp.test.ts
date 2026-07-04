import { beforeAll, describe, expect, it } from "vitest";
import { initTreeSitterChunker, resetTreeSitterChunkerForTests, treeSitterStrategy } from "./tree-sitter-chunker.js";
import { GRAMMAR_WASM_BY_LABEL, WEB_TREE_SITTER_WASM } from "./tree-sitter-test-paths.js";
import type { FileInfo } from "./types.js";

beforeAll(async () => {
  resetTreeSitterChunkerForTests();
  await initTreeSitterChunker({
    webTreeSitterWasm: WEB_TREE_SITTER_WASM,
    grammarWasmByLabel: GRAMMAR_WASM_BY_LABEL,
  });
});

describe("extractSymbolSpansCpp (via treeSitterStrategy)", () => {
  it("parses a top-level C++ function (shared C-style declarator descent)", () => {
    const file: FileInfo = {
      path: "src/foo.cpp",
      content: ["int add(int a, int b) {", "    return a + b;", "}"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: add"))).toBe(true);
  });

  it("parses a class with a method as CLASS | METHOD, and a struct with a method the same way", () => {
    const file: FileInfo = {
      path: "src/shapes.cpp",
      content: [
        "class Foo {",
        "public:",
        "    void bar() {}",
        "};",
        "",
        "struct Point {",
        "    int x;",
        "    void move() {}",
        "};",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Foo") && chunk.text.includes("METHOD: bar"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Point") && chunk.text.includes("METHOD: move"))).toBe(true);
  });

  it("recurses into a namespace's members without emitting a span for the namespace itself", () => {
    const file: FileInfo = {
      path: "src/ns.cpp",
      content: [
        "namespace outer {",
        "    void inner_fn() {}",
        "",
        "    class Inner {",
        "    public:",
        "        void m() {}",
        "    };",
        "}",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: inner_fn"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Inner") && chunk.text.includes("METHOD: m"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("NAMESPACE:"))).toBe(false);
  });

  it("unwraps a template_declaration to its inner class/function, with the span covering the template keyword", () => {
    const file: FileInfo = {
      path: "src/box.cpp",
      content: [
        "template <typename T>",
        "class Box {",
        "public:",
        "    T get() { return val; }",
        "    T val;",
        "};",
        "",
        "template <typename T>",
        "T identity(T x) { return x; }",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    const boxChunk = chunks.find((chunk) => chunk.text.includes("CLASS: Box"));
    expect(boxChunk).toBeDefined();
    expect(boxChunk?.text).toContain("template <typename T>");
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Box") && chunk.text.includes("METHOD: get"))).toBe(true);

    const identityChunk = chunks.find((chunk) => chunk.text.includes("FUNCTION: identity"));
    expect(identityChunk).toBeDefined();
    expect(identityChunk?.text).toContain("template <typename T>");
  });

  it("names an out-of-class method definition with its qualified name (Foo::bar), not the return type", () => {
    // Regression: `declaratorName` couldn't resolve `qualified_identifier` declarators, so
    // `spanFromNode`'s buggy nodeName fallback grabbed the *return type* ("void") as the name and
    // the method body was dropped as a span entirely (only residue coverage kept the text).
    const file: FileInfo = {
      path: "src/foo.cpp",
      content: ["void Foo::bar() {", "  doSomething();", "}"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: Foo::bar") && chunk.text.includes("doSomething();"))).toBe(
      true,
    );
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: void"))).toBe(false);
  });

  it("names an out-of-class constructor and destructor with their qualified names", () => {
    const file: FileInfo = {
      path: "src/ctor.cpp",
      content: ["Foo::Foo() {}", "Foo::~Foo() {}"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: Foo::Foo"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: Foo::~Foo"))).toBe(true);
  });

  it("names a top-level operator overload with its operator name, not the return type", () => {
    // Regression: `operator_name` wasn't a resolvable declarator leaf, so the fallback grabbed the
    // return type ("Foo") as the misleading FUNCTION name.
    const file: FileInfo = {
      path: "src/op.cpp",
      content: ["Foo operator+(const Foo& a, const Foo& b) {", "  return a;", "}"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: operator+"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: Foo"))).toBe(false);
  });

  it("names an in-class destructor and operator overload via their own declarator leaf types", () => {
    const file: FileInfo = {
      path: "src/inclass.cpp",
      content: [
        "class Foo {",
        "public:",
        "    ~Foo() {}",
        "    Foo operator+(const Foo& o) { return *this; }",
        "};",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Foo") && chunk.text.includes("METHOD: ~Foo"))).toBe(true);
    expect(
      chunks.some((chunk) => chunk.text.includes("CLASS: Foo") && chunk.text.includes("METHOD: operator+")),
    ).toBe(true);
  });

  it("falls back to raw chunking for C++ files with no extractable declarations", () => {
    const file: FileInfo = {
      path: "src/empty.cpp",
      content: ["// just a comment"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith("FILE: src/empty.cpp")).toBe(true);
      expect(chunk.text).not.toContain("FUNCTION:");
      expect(chunk.text).not.toContain("CLASS:");
      expect(chunk.text).not.toContain("STRUCT:");
    }
  });
});
