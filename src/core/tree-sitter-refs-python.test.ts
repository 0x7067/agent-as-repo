import { Language, Parser, type Tree } from "web-tree-sitter";
import { beforeAll, describe, expect, it } from "vitest";
import { filterRefsByKind } from "./symbol-refs.js";
import { extractSymbolRefsPython } from "./tree-sitter-refs-python.js";
import { GRAMMAR_WASM_BY_LABEL, WEB_TREE_SITTER_WASM } from "./tree-sitter-test-paths.js";

let parser: Parser;

beforeAll(async () => {
  await Parser.init({ locateFile: () => WEB_TREE_SITTER_WASM });
  parser = new Parser();
  parser.setLanguage(await Language.load(GRAMMAR_WASM_BY_LABEL.python));
});

function parse(source: string): Tree {
  const tree = parser.parse(source);
  if (!tree) throw new Error("parse failed");
  return tree;
}

describe("extractSymbolRefsPython", () => {
  it("extracts import and from-import forms", () => {
    const refs = extractSymbolRefsPython(
      parse("import os\nfrom .foo import bar as b\nfrom pkg import *\n"),
    );
    const imports = filterRefsByKind(refs, "import");
    expect(imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          moduleSpecifier: "os",
          importedNames: [{ local: "os", imported: "*" }],
        }),
        expect.objectContaining({
          moduleSpecifier: ".foo",
          importedNames: [{ local: "b", imported: "bar" }],
        }),
        expect.objectContaining({
          moduleSpecifier: "pkg",
          importedNames: [{ local: "*", imported: "*" }],
        }),
      ]),
    );
  });

  it("extracts bare and attribute calls", () => {
    const refs = extractSymbolRefsPython(parse("foo()\nobj.method()\n"));
    const calls = filterRefsByKind(refs, "call");
    expect(calls.map((c) => ({ callee: c.calleeName, object: c.objectName }))).toEqual([
      { callee: "foo", object: undefined },
      { callee: "method", object: "obj" },
    ]);
  });
});
