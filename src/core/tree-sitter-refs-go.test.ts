import { Language, Parser, type Tree } from "web-tree-sitter";
import { beforeAll, describe, expect, it } from "vitest";
import { filterRefsByKind } from "./symbol-refs.js";
import { extractSymbolRefsGo } from "./tree-sitter-refs-go.js";
import { GRAMMAR_WASM_BY_LABEL, WEB_TREE_SITTER_WASM } from "./tree-sitter-test-paths.js";

let parser: Parser;

beforeAll(async () => {
  await Parser.init({ locateFile: () => WEB_TREE_SITTER_WASM });
  parser = new Parser();
  parser.setLanguage(await Language.load(GRAMMAR_WASM_BY_LABEL.go));
});

function parse(source: string): Tree {
  const tree = parser.parse(source);
  if (!tree) throw new Error("parse failed");
  return tree;
}

const SOURCE = `package main
import (
  "fmt"
  m "math"
  . "strings"
)
func main() {
  fmt.Println()
  m.Sqrt(1)
  foo()
}
`;

describe("extractSymbolRefsGo", () => {
  it("extracts import specs with aliases and dot imports", () => {
    const imports = filterRefsByKind(extractSymbolRefsGo(parse(SOURCE)), "import");
    expect(imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          moduleSpecifier: "fmt",
          importedNames: [{ local: "fmt", imported: "*" }],
        }),
        expect.objectContaining({
          moduleSpecifier: "math",
          importedNames: [{ local: "m", imported: "*" }],
        }),
        expect.objectContaining({
          moduleSpecifier: "strings",
          importedNames: [{ local: "strings", imported: "*" }],
        }),
      ]),
    );
  });

  it("extracts selector and bare calls", () => {
    const calls = filterRefsByKind(extractSymbolRefsGo(parse(SOURCE)), "call");
    expect(calls.map((c) => ({ callee: c.calleeName, object: c.objectName }))).toEqual([
      { callee: "Println", object: "fmt" },
      { callee: "Sqrt", object: "m" },
      { callee: "foo", object: undefined },
    ]);
  });
});
