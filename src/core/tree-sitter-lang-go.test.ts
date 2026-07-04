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

describe("extractSymbolSpansGo (via treeSitterStrategy)", () => {
  it("parses a top-level Go function", () => {
    const file: FileInfo = {
      path: "src/foo.go",
      content: ["package main", "", "func Foo() {", "  println(\"foo\")", "}"].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("FUNCTION: Foo"))).toBe(true);
  });

  it("parses a Go method with a named receiver as CLASS | METHOD, and a type declaration as TYPE", () => {
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

  it("parses a Go method with an unnamed pointer receiver (func (*Server) Reset()) as CLASS | METHOD", () => {
    const file: FileInfo = {
      path: "src/reset.go",
      content: [
        "package main",
        "",
        "type Server struct {",
        "  addr string",
        "}",
        "",
        "func (*Server) Reset() {",
        "  println(\"reset\")",
        "}",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Server") && chunk.text.includes("METHOD: Reset"))).toBe(
      true,
    );
  });

  it("parses a Go method with an unnamed value receiver (func (Server) Value()) as CLASS | METHOD", () => {
    const file: FileInfo = {
      path: "src/value.go",
      content: [
        "package main",
        "",
        "type Server struct {",
        "  addr string",
        "}",
        "",
        "func (Server) Value() {",
        "  println(\"value\")",
        "}",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);
    expect(chunks.some((chunk) => chunk.text.includes("CLASS: Server") && chunk.text.includes("METHOD: Value"))).toBe(
      true,
    );
  });

  it("falls back to raw chunking for Go files with no extractable declarations", () => {
    const file: FileInfo = {
      path: "src/empty.go",
      content: ["package main", "", "// just a comment"].join("\n"),
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
});
