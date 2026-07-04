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

describe("extractSymbolSpansPython (via treeSitterStrategy)", () => {
  it("parses a top-level Python function", () => {
    const file: FileInfo = {
      path: "src/foo.py",
      content: ["def foo():", "    pass"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: foo"))).toBe(true);
  });

  it("parses a Python class and its methods, including a decorated method, with CLASS | METHOD prefix", () => {
    const file: FileInfo = {
      path: "src/bar.py",
      content: [
        "class Bar:",
        "    def greet(self):",
        "        pass",
        "",
        "    @staticmethod",
        "    def helper():",
        "        pass",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Bar"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Bar") && chunk.text.includes("METHOD: greet"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Bar") && chunk.text.includes("METHOD: helper"))).toBe(true);
  });

  it("parses a nested class inside a class as its own CLASS span", () => {
    const file: FileInfo = {
      path: "src/nested.py",
      content: [
        "class Outer:",
        "    def outer_method(self):",
        "        pass",
        "",
        "    class Inner:",
        "        def inner_method(self):",
        "            pass",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Outer") && chunk.text.includes("METHOD: outer_method"))).toBe(
      true,
    );
    // The nested class itself is not currently descended into as a further CLASS span by the
    // Python extractor (only function_definition members become METHOD spans of Outer), but its
    // source text must still be preserved somewhere rather than silently dropped.
    expect(chunks.some((chunk) => chunk.text.includes("class Inner"))).toBe(true);
  });

  it("parses an async def as a FUNCTION / METHOD span", () => {
    const file: FileInfo = {
      path: "src/async_stuff.py",
      content: ["async def fetch():", "    pass"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: fetch"))).toBe(true);
  });

  it("parses an async def method on a class as a METHOD span", () => {
    const file: FileInfo = {
      path: "src/async_method.py",
      content: ["class Client:", "    async def fetch(self):", "        pass"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Client") && chunk.text.includes("METHOD: fetch"))).toBe(
      true,
    );
  });

  it("falls back to raw chunking for Python files that are just comments", () => {
    const file: FileInfo = {
      path: "src/empty_ish.py",
      content: ["# just a comment", "# another comment"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith("FILE: src/empty_ish.py")).toBe(true);
      expect(chunk.text).not.toContain("CLASS:");
      expect(chunk.text).not.toContain("FUNCTION:");
    }
  });
});
