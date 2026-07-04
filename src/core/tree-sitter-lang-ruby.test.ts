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

describe("extractSymbolSpansRuby (via treeSitterStrategy)", () => {
  it("parses a top-level Ruby method", () => {
    const file: FileInfo = {
      path: "src/foo.rb",
      content: ["def foo", "  puts 'foo'", "end"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: foo"))).toBe(true);
  });

  // Regression: a top-level `def self.foo ... end` is a `singleton_method` node, distinct from
  // the top-level `method` node type. Before the fix, extractFromRubyDeclaration had no case for
  // it, so it produced zero spans for that declaration — and because sibling spans existed
  // (the class below), span-based chunking ran and the singleton method's source text ended up
  // in NO chunk at all (silent content loss).
  it("does not drop a top-level singleton method (def self.foo) when other spans exist in the file", () => {
    const file: FileInfo = {
      path: "src/mixed.rb",
      content: [
        "def self.foo",
        "  puts 'foo'",
        "end",
        "",
        "class Dog",
        "  def bark",
        "    puts 'woof'",
        "  end",
        "end",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);

    // The singleton method's body text must survive in some chunk.
    expect(chunks.some((chunk) => chunk.text.includes("puts 'foo'"))).toBe(true);
    // ...under a FUNCTION header for it.
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: foo") && chunk.text.includes("puts 'foo'"))).toBe(
      true,
    );
  });

  it("parses a Ruby class with a method as CLASS | METHOD", () => {
    const file: FileInfo = {
      path: "src/dog.rb",
      content: ["class Dog", "  def bark", "    puts 'woof'", "  end", "end"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Dog") && chunk.text.includes("METHOD: bark"))).toBe(
      true,
    );
  });

  it("parses a Ruby module with a method as MODULE | METHOD (container-kind aware header)", () => {
    const file: FileInfo = {
      path: "src/greeter.rb",
      content: ["module Greeter", "  def self.hello", "    puts 'hello'", "  end", "end"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FILE: src/greeter.rb | MODULE: Greeter"))).toBe(true);
    // Method headers now reflect the container kind: MODULE, not CLASS.
    expect(chunks.some((chunk) => chunk.text.includes("MODULE: Greeter") && chunk.text.includes("METHOD: hello"))).toBe(
      true,
    );
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Greeter"))).toBe(false);
  });

  it("falls back to raw chunking for Ruby files that are just comments", () => {
    const file: FileInfo = {
      path: "src/empty.rb",
      content: ["# just a comment", "# another comment"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith("FILE: src/empty.rb")).toBe(true);
      expect(chunk.text).not.toContain("CLASS:");
      expect(chunk.text).not.toContain("FUNCTION:");
      expect(chunk.text).not.toContain("MODULE:");
    }
  });
});
