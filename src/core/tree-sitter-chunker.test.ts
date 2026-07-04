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
