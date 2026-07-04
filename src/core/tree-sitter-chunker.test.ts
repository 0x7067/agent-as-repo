import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  initTreeSitterChunker,
  resetTreeSitterChunkerForTests,
  treeSitterStrategy,
  type GrammarLabel,
} from "./tree-sitter-chunker.js";
import type { FileInfo } from "./types.js";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

function wasmPath(pkg: string, file: string): string {
  return path.join(ROOT, "node_modules", pkg, file);
}

const GRAMMAR_WASM_BY_LABEL: Record<GrammarLabel, string> = {
  typescript: wasmPath("tree-sitter-typescript", "tree-sitter-typescript.wasm"),
  tsx: wasmPath("tree-sitter-typescript", "tree-sitter-tsx.wasm"),
  javascript: wasmPath("tree-sitter-javascript", "tree-sitter-javascript.wasm"),
  python: wasmPath("tree-sitter-python", "tree-sitter-python.wasm"),
  go: wasmPath("tree-sitter-go", "tree-sitter-go.wasm"),
  java: wasmPath("tree-sitter-java", "tree-sitter-java.wasm"),
  ruby: wasmPath("tree-sitter-ruby", "tree-sitter-ruby.wasm"),
};

beforeAll(async () => {
  resetTreeSitterChunkerForTests();
  await initTreeSitterChunker({
    webTreeSitterWasm: wasmPath("web-tree-sitter", "web-tree-sitter.wasm"),
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

  it("parses Java class methods with CLASS | METHOD prefix (Java is now a supported grammar)", () => {
    const file: FileInfo = {
      path: "src/Foo.java",
      content: [
        "public class Foo {",
        "  void bar() {",
        "    System.out.println(\"bar\");",
        "  }",
        "}",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Foo"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("METHOD: bar"))).toBe(true);
  });

  it("parses a Java interface and enum as top-level declarations", () => {
    const file: FileInfo = {
      path: "src/Shapes.java",
      content: [
        "public interface Shape {",
        "  double area();",
        "}",
        "",
        "enum Color {",
        "  RED, GREEN, BLUE",
        "}",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("INTERFACE: Shape"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("ENUM: Color"))).toBe(true);
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

  it("parses a top-level Python function", () => {
    const file: FileInfo = {
      path: "src/foo.py",
      content: [
        "def foo():",
        "    pass",
      ].join("\n"),
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

  it("falls back to raw chunking for Python files that are just comments", () => {
    const file: FileInfo = {
      path: "src/empty_ish.py",
      content: [
        "# just a comment",
        "# another comment",
      ].join("\n"),
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

  it("parses a top-level Go function", () => {
    const file: FileInfo = {
      path: "src/foo.go",
      content: [
        "package main",
        "",
        "func Foo() {",
        "  println(\"foo\")",
        "}",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: Foo"))).toBe(true);
  });

  it("parses a Go method with a receiver as CLASS | METHOD, and a type declaration as TYPE", () => {
    const file: FileInfo = {
      path: "src/server.go",
      content: [
        "package main",
        "",
        "type Server struct {",
        "  addr string",
        "}",
        "",
        "func (s *Server) Start() {",
        "  println(s.addr)",
        "}",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("TYPE: Server"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Server") && chunk.text.includes("METHOD: Start"))).toBe(true);
  });

  it("falls back to raw chunking for Go files with no extractable declarations", () => {
    const file: FileInfo = {
      path: "src/empty.go",
      content: [
        "package main",
        "",
        "// just a comment",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith("FILE: src/empty.go")).toBe(true);
      expect(chunk.text).not.toContain("CLASS:");
      expect(chunk.text).not.toContain("FUNCTION:");
      expect(chunk.text).not.toContain("TYPE:");
    }
  });

  it("parses a top-level Ruby method", () => {
    const file: FileInfo = {
      path: "src/foo.rb",
      content: [
        "def foo",
        "  puts 'foo'",
        "end",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: foo"))).toBe(true);
  });

  it("parses a Ruby module with a method as MODULE | METHOD", () => {
    const file: FileInfo = {
      path: "src/greeter.rb",
      content: [
        "module Greeter",
        "  def self.hello",
        "    puts 'hello'",
        "  end",
        "end",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FILE: src/greeter.rb | MODULE: Greeter"))).toBe(true);
    // Method headers keep the existing "CLASS: <container> | METHOD: <name>" format regardless of
    // whether the container was a class or a module (buildPrefix does not special-case MODULE).
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Greeter") && chunk.text.includes("METHOD: hello"))).toBe(true);
  });

  it("parses a Ruby class with a method as CLASS | METHOD", () => {
    const file: FileInfo = {
      path: "src/dog.rb",
      content: [
        "class Dog",
        "  def bark",
        "    puts 'woof'",
        "  end",
        "end",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Dog") && chunk.text.includes("METHOD: bark"))).toBe(true);
  });

  it("falls back to raw chunking for Ruby files that are just comments", () => {
    const file: FileInfo = {
      path: "src/empty.rb",
      content: [
        "# just a comment",
        "# another comment",
      ].join("\n"),
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

  it("falls back to raw chunking for unsupported languages like C#, instead of misparsing with the TS grammar", () => {
    const file: FileInfo = {
      path: "src/Foo.cs",
      content: "public class Foo { void Bar() {} }",
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith("FILE: src/Foo.cs")).toBe(true);
      expect(chunk.text).not.toContain("CLASS:");
      expect(chunk.text).not.toContain("METHOD:");
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
