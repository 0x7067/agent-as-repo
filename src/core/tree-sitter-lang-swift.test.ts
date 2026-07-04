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

describe("extractSymbolSpansSwift (via treeSitterStrategy)", () => {
  it("parses a top-level Swift function", () => {
    const file: FileInfo = {
      path: "src/Util.swift",
      content: ["func add(_ a: Int, _ b: Int) -> Int {", "    return a + b", "}"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: add"))).toBe(true);
  });

  it("parses a Swift class with a method (CLASS | METHOD header)", () => {
    const file: FileInfo = {
      path: "src/Foo.swift",
      content: ["class Foo {", "    func bar() -> Int {", "        return 1", "    }", "}"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Foo") && chunk.text.includes("METHOD: bar"))).toBe(
      true,
    );
  });

  // Grammar-specific case: struct/class/enum/extension/actor all parse as the same
  // `class_declaration` node type, distinguished only by the `declaration_kind` field.
  it("parses a Swift struct as STRUCT, with its method under the type's CLASS-labeled container header", () => {
    const file: FileInfo = {
      path: "src/Point.swift",
      content: ["struct Point {", "    var x: Int", "    func length() -> Int {", "        return x", "    }", "}"].join(
        "\n",
      ),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("STRUCT: Point"))).toBe(true);
    // Method headers use the shared "CLASS: <container> | METHOD: <name>" convention regardless of
    // the container's own SymbolKind (STRUCT here) — see collectDeclaratorMethods's C/C++ precedent.
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Point") && chunk.text.includes("METHOD: length"))).toBe(
      true,
    );
  });

  it("parses a Swift extension's methods under the extended type's name", () => {
    const file: FileInfo = {
      path: "src/FooExt.swift",
      content: ["extension Foo {", "    func baz() -> Int {", "        return 1", "    }", "}"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Foo") && chunk.text.includes("METHOD: baz"))).toBe(
      true,
    );
  });

  it("parses a Swift protocol as INTERFACE", () => {
    const file: FileInfo = {
      path: "src/Greeter.swift",
      content: ["protocol Greeter {", "    func greet() -> String", "}"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("INTERFACE: Greeter"))).toBe(true);
  });

  it("names init/deinit declarations inside a class as METHOD: init / METHOD: deinit", () => {
    const file: FileInfo = {
      path: "src/Lifecycle.swift",
      content: [
        "class Foo {",
        "    init() {",
        "        print(\"created\")",
        "    }",
        "    deinit {",
        "        print(\"destroyed\")",
        "    }",
        "}",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Foo") && chunk.text.includes("METHOD: init"))).toBe(
      true,
    );
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Foo") && chunk.text.includes("METHOD: deinit"))).toBe(
      true,
    );
  });

  it("falls back to raw chunking for Swift files with no extractable declarations", () => {
    const file: FileInfo = {
      path: "src/Comment.swift",
      content: "// just a comment\n",
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith("FILE: src/Comment.swift")).toBe(true);
      expect(chunk.text).not.toContain("CLASS:");
      expect(chunk.text).not.toContain("METHOD:");
    }
  });

  it("residue coverage: keeps a top-level import alongside a function", () => {
    const file: FileInfo = {
      path: "src/Main.swift",
      content: ["import Foundation", "", "func addOne(_ x: Int) -> Int {", "    return x + 1", "}"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: addOne"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("import Foundation"))).toBe(true);
  });
});
