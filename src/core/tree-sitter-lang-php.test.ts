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

describe("extractSymbolSpansPhp (via treeSitterStrategy)", () => {
  it("parses a top-level PHP function, wrapped in the <?php tag", () => {
    const file: FileInfo = {
      path: "src/foo.php",
      content: ["<?php", "", "function foo() {", "    return 1;", "}"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: foo"))).toBe(true);
  });

  it("parses a PHP class and its methods with CLASS | METHOD prefix", () => {
    const file: FileInfo = {
      path: "src/bar.php",
      content: [
        "<?php",
        "",
        "class Bar {",
        "    public function baz() {",
        "        return 2;",
        "    }",
        "}",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Bar") && chunk.text.includes("METHOD: baz"))).toBe(true);
  });

  it("parses a PHP interface and trait as top-level declarations", () => {
    const file: FileInfo = {
      path: "src/shapes.php",
      content: [
        "<?php",
        "",
        "interface Shape {",
        "    public function area();",
        "}",
        "",
        "trait Greetable {",
        "    public function greet() {}",
        "}",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("INTERFACE: Shape"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("TRAIT: Greetable"))).toBe(true);
  });

  it("falls back to raw chunking for PHP files with no extractable declarations", () => {
    const file: FileInfo = {
      path: "src/empty.php",
      content: ["<?php", "", "// just a comment"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith("FILE: src/empty.php")).toBe(true);
      expect(chunk.text).not.toContain("CLASS:");
      expect(chunk.text).not.toContain("FUNCTION:");
      expect(chunk.text).not.toContain("INTERFACE:");
      expect(chunk.text).not.toContain("TRAIT:");
    }
  });
});
