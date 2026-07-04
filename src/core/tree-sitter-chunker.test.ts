import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  initTreeSitterChunker,
  resetTreeSitterChunkerForTests,
  treeSitterStrategy,
} from "./tree-sitter-chunker.js";
import type { FileInfo } from "./types.js";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

beforeAll(async () => {
  resetTreeSitterChunkerForTests();
  await initTreeSitterChunker({
    webTreeSitterWasm: path.join(ROOT, "node_modules/web-tree-sitter/web-tree-sitter.wasm"),
    typescriptWasm: path.join(ROOT, "node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm"),
    tsxWasm: path.join(ROOT, "node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm"),
    javascriptWasm: path.join(ROOT, "node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm"),
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

  it("falls back to raw chunking for unsupported languages like Java, instead of misparsing with the TS grammar", () => {
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
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith("FILE: src/Foo.java")).toBe(true);
      expect(chunk.text).not.toContain("CLASS:");
      expect(chunk.text).not.toContain("METHOD:");
    }
  });

  it("falls back to raw chunking for Python (TS grammar extracts no spans, so this is a safe-degradation case, not a regression pin)", () => {
    const file: FileInfo = {
      path: "src/foo.py",
      content: [
        "def foo():",
        "    pass",
        "",
        "class Bar:",
        "    pass",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith("FILE: src/foo.py")).toBe(true);
      expect(chunk.text).not.toContain("CLASS:");
      expect(chunk.text).not.toContain("FUNCTION:");
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
