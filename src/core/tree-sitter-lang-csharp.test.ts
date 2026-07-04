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

describe("extractSymbolSpansCsharp (via treeSitterStrategy)", () => {
  // Positive parsing test migrated from tree-sitter-chunker.test.ts, which previously used this
  // exact fixture as the "unsupported language" regression pin before C# became supported.
  it("parses a C# class and its method with CLASS | METHOD prefix", () => {
    const file: FileInfo = {
      path: "src/Foo.cs",
      content: "public class Foo { void Bar() {} }",
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Foo") && chunk.text.includes("METHOD: Bar"))).toBe(true);
  });

  it("parses an interface, struct, enum and record as top-level declarations", () => {
    const file: FileInfo = {
      path: "src/Shapes.cs",
      content: [
        "public interface IShape {",
        "    double Area();",
        "}",
        "",
        "public struct Point {",
        "    public int X;",
        "    public void Reset() {}",
        "}",
        "",
        "public enum Color { Red, Green, Blue }",
        "",
        "public record Person(string Name);",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("INTERFACE: IShape"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("STRUCT: Point"))).toBe(true);
    // Struct methods use "CLASS" as the container token in the header (same simplification as
    // Rust impl methods and C++ struct methods) — there's no dedicated STRUCT container-kind.
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Point") && chunk.text.includes("METHOD: Reset"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("ENUM: Color"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Person"))).toBe(true);
  });

  it("recurses into a block-scoped namespace's members without emitting a span for the namespace itself", () => {
    const file: FileInfo = {
      path: "src/Namespaced.cs",
      content: [
        "namespace MyApp {",
        "    public class Foo {",
        "        public void Bar() {}",
        "    }",
        "}",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Foo") && chunk.text.includes("METHOD: Bar"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("NAMESPACE:"))).toBe(false);
  });

  it("handles a file-scoped namespace declaration, whose members are top-level siblings", () => {
    const file: FileInfo = {
      path: "src/FileScoped.cs",
      content: ["namespace MyApp;", "", "public class Baz {", "    public void Qux() {}", "}"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Baz") && chunk.text.includes("METHOD: Qux"))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("NAMESPACE:"))).toBe(false);
  });

  it("residue coverage: keeps top-level statements (Program.cs style) alongside a class", () => {
    // Top-level statements are `global_statement` nodes with no extractor case of their own; the
    // span-based chunker used to drop them silently once the CLASS span below existed.
    const file: FileInfo = {
      path: "src/Program.cs",
      content: [
        "Console.WriteLine(\"starting\");",
        "",
        "public class Foo {",
        "    public void Bar() {}",
        "}",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Foo") && chunk.text.includes("METHOD: Bar"))).toBe(true);
    const residueChunk = chunks.find((chunk) => chunk.text.includes("Console.WriteLine"));
    expect(residueChunk).toBeDefined();
    expect(residueChunk?.text.startsWith("FILE: src/Program.cs")).toBe(true);
    expect(residueChunk?.text).not.toContain("CLASS:");
  });

  it("falls back to raw chunking for C# files with no extractable declarations", () => {
    const file: FileInfo = {
      path: "src/Empty.cs",
      content: "// just a comment\n",
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith("FILE: src/Empty.cs")).toBe(true);
      expect(chunk.text).not.toContain("CLASS:");
      expect(chunk.text).not.toContain("METHOD:");
      expect(chunk.text).not.toContain("INTERFACE:");
      expect(chunk.text).not.toContain("STRUCT:");
      expect(chunk.text).not.toContain("ENUM:");
    }
  });
});
