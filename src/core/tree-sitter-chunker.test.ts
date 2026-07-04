import { beforeAll, describe, expect, it } from "vitest";
import {
  initTreeSitterChunker,
  resetTreeSitterChunkerForTests,
  treeSitterStrategy,
} from "./tree-sitter-chunker.js";
import { GRAMMAR_WASM_BY_LABEL, WEB_TREE_SITTER_WASM } from "./tree-sitter-test-paths.js";
import type { FileInfo } from "./types.js";

beforeAll(async () => {
  resetTreeSitterChunkerForTests();
  await initTreeSitterChunker({
    webTreeSitterWasm: WEB_TREE_SITTER_WASM,
    grammarWasmByLabel: GRAMMAR_WASM_BY_LABEL,
  });
});

describe("treeSitterStrategy", () => {
  it("produces one chunk per top-level function declaration", () => {
    const file: FileInfo = {
      path: "src/example.ts",
      content: [
        "export function foo(): void {",
        "  console.log('foo');",
        "}",
        "",
        "export function bar(): void {",
        "  console.log('bar');",
        "}",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: foo"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: bar"))).toBe(true);
  });

  it("falls back to raw chunking for files with no extractable symbols", () => {
    const file: FileInfo = { path: "src/data.ts", content: "export const X = 1;\nexport const Y = 2;\n", sizeKb: 0.1 };
    const chunks = treeSitterStrategy(file);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.text).toContain("FILE: src/data.ts");
  });

  it("returns an empty array for empty content", () => {
    const file: FileInfo = { path: "src/empty.ts", content: "", sizeKb: 0 };
    expect(treeSitterStrategy(file)).toEqual([]);
  });

  it("handles unparseable syntax by falling back to raw chunking instead of throwing", () => {
    const file: FileInfo = { path: "src/broken.ts", content: "function( { [ ===", sizeKb: 0.1 };
    expect(() => treeSitterStrategy(file)).not.toThrow();
    expect(treeSitterStrategy(file).length).toBeGreaterThan(0);
  });

  it("includes class methods with CLASS | METHOD prefix", () => {
    const file: FileInfo = {
      path: "src/service.ts",
      content: [
        "export class SyncOrchestrator {",
        "  run(): void {",
        "    console.log('run');",
        "  }",
        "}",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: SyncOrchestrator"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("METHOD: run"))).toBe(true);
  });

  it("parses .mts files with the typescript grammar", () => {
    const file: FileInfo = {
      path: "src/example.mts",
      content: "export function foo(): void {\n  console.log('foo');\n}\n",
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: foo"))).toBe(true);
  });

  it("parses .cts files with the typescript grammar", () => {
    const file: FileInfo = {
      path: "src/example.cts",
      content: "export function foo(): void {\n  console.log('foo');\n}\n",
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: foo"))).toBe(true);
  });

  // Java-specific coverage (class methods, interface/enum, enum-with-methods, comment-only
  // fallback) lives in tree-sitter-lang-java.test.ts.
  // Python-specific coverage (top-level function, class/method, decorated + nested + async def,
  // comment-only fallback) lives in tree-sitter-lang-python.test.ts.
  // Go-specific coverage (top-level function, receiver method incl. unnamed receivers, type decl,
  // comment-only fallback) lives in tree-sitter-lang-go.test.ts.
  // Ruby-specific coverage (top-level method, class/module methods, comment-only fallback,
  // the singleton_method regression) lives in tree-sitter-lang-ruby.test.ts.
  // Rust-specific coverage (function/struct/enum/trait, impl block methods, mod recursion,
  // type alias, comment-only fallback) lives in tree-sitter-lang-rust.test.ts.
  // PHP-specific coverage (<?php-wrapped function, class methods, interface/trait, comment-only
  // fallback) lives in tree-sitter-lang-php.test.ts.
  // C-specific coverage (function_declarator name descent, struct/enum with body, typedef,
  // bare-prototype skip, comment-only fallback) lives in tree-sitter-lang-c.test.ts.
  // C++-specific coverage (class/struct methods, namespace recursion, template unwrapping,
  // comment-only fallback) lives in tree-sitter-lang-cpp.test.ts.
  // C#-specific coverage (class/interface/struct/enum/record, namespace + file-scoped namespace
  // recursion, comment-only fallback) lives in tree-sitter-lang-csharp.test.ts.

  it("parses .hpp files with the C++ grammar", () => {
    const file: FileInfo = {
      path: "src/example.hpp",
      content: ["class Foo {", "public:", "    void bar() {}", "};"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Foo") && chunk.text.includes("METHOD: bar"))).toBe(true);
  });

  it("parses .h files with the C grammar", () => {
    const file: FileInfo = {
      path: "src/example.h",
      content: ["struct Point {", "    int x;", "    int y;", "};"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("STRUCT: Point"))).toBe(true);
  });

  it("falls back to raw chunking for unsupported languages like Kotlin, instead of misparsing with the TS grammar", () => {
    // Real-world "misparse hazard" fixture: brace-style syntax close enough to a TS/JS class body
    // that the TypeScript grammar produces a plausible-looking class_declaration/method_definition
    // tree for it (see the revert experiment in the Slice 2 report — temporarily letting unmapped
    // extensions default to the "typescript" grammar makes this fixture yield CLASS:/METHOD:
    // headers). Kotlin (like Swift) has no wasm grammar wired up yet, so it must stay on the
    // explicit-map-returns-null -> raw-fallback path.
    const file: FileInfo = {
      path: "src/Foo.kt",
      content: "class Foo { fun bar() {} }",
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith("FILE: src/Foo.kt")).toBe(true);
      expect(chunk.text).not.toContain("CLASS:");
      expect(chunk.text).not.toContain("METHOD:");
    }
  });

  it("residue coverage: keeps top-level side-effect statements that sit alongside a function (JS)", () => {
    // Regression for the systemic span-based chunking bug: as soon as ANY span is extracted for a
    // file, source text not covered by a span used to be silently dropped. Here `doSetup()` sits
    // outside the one extracted FUNCTION span and must still show up in some chunk.
    const file: FileInfo = {
      path: "src/init.js",
      content: [
        "doSetup();",
        "",
        "function foo() {",
        "  return 1;",
        "}",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: foo"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("doSetup();"))).toBe(true);
    // The residue chunk carries the plain FILE header, not a symbol header.
    const residueChunk = chunks.find((chunk) => chunk.text.includes("doSetup();"));
    expect(residueChunk?.text.startsWith("FILE: src/init.js")).toBe(true);
    expect(residueChunk?.text).not.toContain("FUNCTION:");
  });

  it("residue coverage: never emits a chunk that is just leftover punctuation/whitespace", () => {
    const file: FileInfo = {
      path: "src/service.js",
      content: [
        "function foo() {",
        "  return 1;",
        "}",
        "",
        "function bar() {",
        "  return 2;",
        "}",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    for (const chunk of chunks) {
      const body = chunk.text.slice(chunk.text.indexOf("\n\n") + 2);
      expect(/[a-z0-9]/i.test(body)).toBe(true);
    }
  });

  it("falls back to raw chunking for extensionless files like Makefile/Dockerfile", () => {
    const file: FileInfo = {
      path: "Makefile",
      content: [
        "build:",
        "\techo building",
        "",
        "test:",
        "\techo testing",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith("FILE: Makefile")).toBe(true);
      expect(chunk.text).not.toContain("CLASS:");
      expect(chunk.text).not.toContain("METHOD:");
      expect(chunk.text).not.toContain("FUNCTION:");
    }
  });
});
