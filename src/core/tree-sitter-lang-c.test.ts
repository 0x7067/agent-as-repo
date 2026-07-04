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

describe("extractSymbolSpansC (via treeSitterStrategy)", () => {
  it("parses a top-level C function, whose name is nested inside a function_declarator", () => {
    const file: FileInfo = {
      path: "src/foo.c",
      content: ["int add(int a, int b) {", "    return a + b;", "}"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: add"))).toBe(true);
  });

  it("parses a struct with a body as STRUCT and an enum with a body as ENUM", () => {
    const file: FileInfo = {
      path: "src/shapes.c",
      content: [
        "struct Point {",
        "    int x;",
        "    int y;",
        "};",
        "",
        "enum Color {",
        "    RED, GREEN, BLUE",
        "};",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("STRUCT: Point"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("ENUM: Color"))).toBe(true);
  });

  it("parses a typedef as TYPE, named after the alias (last type_identifier child)", () => {
    const file: FileInfo = {
      path: "src/alias.c",
      content: ["struct Point { int x; int y; };", "typedef struct Point Point;"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("TYPE: Point"))).toBe(true);
  });

  it("skips a bare function prototype (no body) instead of emitting a FUNCTION span for it", () => {
    const file: FileInfo = {
      path: "src/proto.c",
      content: [
        "int add(int a, int b) {",
        "    return a + b;",
        "}",
        "",
        "int prototype_only(int x);",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    const functionChunks = chunks.filter((chunk) => chunk.text.includes("FUNCTION:"));
    expect(functionChunks.some((chunk) => chunk.text.includes("FUNCTION: add"))).toBe(true);
    expect(functionChunks.some((chunk) => chunk.text.includes("FUNCTION: prototype_only"))).toBe(false);
  });

  it("parses a #ifdef-guarded top-level function, giving it a FUNCTION span like an unguarded one", () => {
    const file: FileInfo = {
      path: "src/guarded.c",
      content: [
        "#ifdef FEATURE_FLAG",
        "int guarded(int x) {",
        "    return x + 1;",
        "}",
        "#endif",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: guarded"))).toBe(true);
  });

  it("resolves a function-pointer typedef's alias name by descending the declarator chain", () => {
    const file: FileInfo = {
      path: "src/funcptr.c",
      content: "typedef int (*FuncPtr)(int, int);",
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("TYPE: FuncPtr"))).toBe(true);
  });

  it("falls back to raw chunking for C files with no extractable declarations", () => {
    const file: FileInfo = {
      path: "src/empty.c",
      content: ["// just a comment"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith("FILE: src/empty.c")).toBe(true);
      expect(chunk.text).not.toContain("FUNCTION:");
      expect(chunk.text).not.toContain("STRUCT:");
      expect(chunk.text).not.toContain("ENUM:");
      expect(chunk.text).not.toContain("TYPE:");
    }
  });
});
