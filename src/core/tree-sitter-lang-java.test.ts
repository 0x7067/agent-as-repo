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

describe("extractSymbolSpansJava (via treeSitterStrategy)", () => {
  it("parses Java class methods with CLASS | METHOD prefix", () => {
    const file: FileInfo = {
      path: "src/Foo.java",
      content: ["public class Foo {", "  void bar() {", "    System.out.println(\"bar\");", "  }", "}"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Foo"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("METHOD: bar"))).toBe(true);
  });

  it("parses a Java interface and enum as top-level declarations", () => {
    const file: FileInfo = {
      path: "src/Shapes.java",
      content: ["public interface Shape {", "  double area();", "}", "", "enum Color {", "  RED, GREEN, BLUE", "}"].join(
        "\n",
      ),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("INTERFACE: Shape"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("ENUM: Color"))).toBe(true);
  });

  // Regression: enum { ...; methods } wraps its methods in enum_body -> enum_body_declarations,
  // not directly under a "body" field the way class/record bodies do. Before the fix, the enum
  // extractor only emitted a single ENUM span and never descended into enum_body_declarations, so
  // `hex()`'s method never got its own METHOD span/header (though its text still appeared inside
  // the enum's own chunk).
  it("splits enum methods into their own METHOD spans (enum_body -> enum_body_declarations)", () => {
    const file: FileInfo = {
      path: "src/Color.java",
      content: [
        "enum Color {",
        "  RED, GREEN;",
        "",
        "  public String hex() {",
        "    return \"#000000\";",
        "  }",
        "}",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("ENUM: Color"))).toBe(true);
    // Method headers use the same "CLASS: <container> | METHOD: <name>" format as class/record
    // methods (buildPrefix does not special-case ENUM containers).
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Color") && chunk.text.includes("METHOD: hex"))).toBe(true);
  });

  it("falls back to raw chunking for Java files with no extractable declarations", () => {
    const file: FileInfo = {
      path: "src/Comment.java",
      content: "// just a comment\n",
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith("FILE: src/Comment.java")).toBe(true);
      expect(chunk.text).not.toContain("CLASS:");
      expect(chunk.text).not.toContain("METHOD:");
    }
  });
});
