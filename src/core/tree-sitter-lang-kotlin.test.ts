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

describe("extractSymbolSpansKotlin (via treeSitterStrategy)", () => {
  it("parses a top-level Kotlin function", () => {
    const file: FileInfo = {
      path: "src/Util.kt",
      content: ["fun add(a: Int, b: Int): Int {", "    return a + b", "}"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: add"))).toBe(true);
  });

  it("parses a Kotlin class with a method (CLASS | METHOD header)", () => {
    const file: FileInfo = {
      path: "src/Foo.kt",
      content: ["class Foo(val x: Int) {", "    fun bar(): Int {", "        return x", "    }", "}"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Foo") && chunk.text.includes("METHOD: bar"))).toBe(true);
  });

  // This exact single-line fixture used to be tree-sitter-chunker.test.ts's regression pin for
  // "unsupported language falls back to raw chunking instead of misparsing with the TS grammar"
  // (back when Kotlin had no wasm grammar wired up at all). Now that Kotlin is a real supported
  // grammar, it's moved here as a positive case instead — Scala took over as that regression's pin.
  it("parses the single-line class-with-method fixture that used to pin the unsupported-language fallback", () => {
    const file: FileInfo = {
      path: "src/Foo.kt",
      content: "class Foo { fun bar() {} }",
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Foo") && chunk.text.includes("METHOD: bar"))).toBe(true);
  });

  // Grammar-specific case: `object` declarations (Kotlin singletons) and a class's `companion
  // object` (whose members act like the class's static members) both nest their members one level
  // deeper than an ordinary class_body -> function_declaration.
  it("parses an object declaration as MODULE, and a companion object's methods as METHODs of the enclosing class", () => {
    const file: FileInfo = {
      path: "src/Shapes.kt",
      content: [
        "object Registry {",
        "    fun register() {}",
        "}",
        "",
        "class Circle(val r: Double) {",
        "    companion object {",
        "        fun unit(): Circle = Circle(1.0)",
        "    }",
        "}",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(
      chunks.some((chunk) => chunk.text.includes("MODULE: Registry") && chunk.text.includes("METHOD: register")),
    ).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Circle") && chunk.text.includes("METHOD: unit"))).toBe(
      true,
    );
  });

  it("parses a top-level type alias", () => {
    const file: FileInfo = {
      path: "src/Types.kt",
      content: "typealias IntList = List<Int>\n",
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("TYPE: IntList"))).toBe(true);
  });

  it("falls back to raw chunking for Kotlin files with no extractable declarations", () => {
    const file: FileInfo = {
      path: "src/Comment.kt",
      content: "// just a comment\n",
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith("FILE: src/Comment.kt")).toBe(true);
      expect(chunk.text).not.toContain("CLASS:");
      expect(chunk.text).not.toContain("METHOD:");
    }
  });

  it("residue coverage: keeps a top-level const declaration alongside a function", () => {
    const file: FileInfo = {
      path: "src/Config.kt",
      content: ["const val MAX = 10", "", "fun clamp(x: Int): Int {", "    return if (x > MAX) MAX else x", "}"].join(
        "\n",
      ),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: clamp"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("MAX = 10"))).toBe(true);
  });
});
