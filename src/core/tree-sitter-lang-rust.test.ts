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

describe("extractSymbolSpansRust (via treeSitterStrategy)", () => {
  it("parses a top-level Rust function", () => {
    const file: FileInfo = {
      path: "src/foo.rs",
      content: ["fn foo() {", "    println!(\"foo\");", "}"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: foo"))).toBe(true);
  });

  it("parses a struct, an enum and a trait as top-level declarations", () => {
    const file: FileInfo = {
      path: "src/shapes.rs",
      content: [
        "struct Point { x: i32, y: i32 }",
        "",
        "enum Color { Red, Green, Blue }",
        "",
        "trait Greet { fn hello(&self); }",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("STRUCT: Point"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("ENUM: Color"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("TRAIT: Greet"))).toBe(true);
  });

  it("parses an impl block's methods as CLASS | METHOD spans named after the impl'd type, without a span for the impl block itself", () => {
    const file: FileInfo = {
      path: "src/point.rs",
      content: [
        "struct Point { x: i32, y: i32 }",
        "",
        "impl Point {",
        "    fn new() -> Self {",
        "        Point { x: 0, y: 0 }",
        "    }",
        "",
        "    fn dist(&self) -> f64 {",
        "        0.0",
        "    }",
        "}",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Point") && chunk.text.includes("METHOD: new"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Point") && chunk.text.includes("METHOD: dist"))).toBe(true);
    // No standalone span/header for the impl block itself.
    expect(chunks.some((chunk) => chunk.text.includes("IMPL:"))).toBe(false);
  });

  it("parses a mod block as MODULE, with its top-level functions as MODULE | METHOD spans", () => {
    const file: FileInfo = {
      path: "src/stuff.rs",
      content: ["mod stuff {", "    pub fn helper() {", "        println!(\"help\");", "    }", "}"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FILE: src/stuff.rs | MODULE: stuff"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("MODULE: stuff") && chunk.text.includes("METHOD: helper"))).toBe(
      true,
    );
  });

  it("parses a trivial type alias as TYPE", () => {
    const file: FileInfo = {
      path: "src/alias.rs",
      content: "type Alias = i32;",
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("TYPE: Alias"))).toBe(true);
  });

  it("falls back to raw chunking for Rust files with no extractable declarations", () => {
    const file: FileInfo = {
      path: "src/empty.rs",
      content: ["// just a comment", "// another comment"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith("FILE: src/empty.rs")).toBe(true);
      expect(chunk.text).not.toContain("STRUCT:");
      expect(chunk.text).not.toContain("ENUM:");
      expect(chunk.text).not.toContain("TRAIT:");
      expect(chunk.text).not.toContain("FUNCTION:");
      expect(chunk.text).not.toContain("MODULE:");
    }
  });
});
