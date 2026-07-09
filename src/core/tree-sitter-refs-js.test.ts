import { Language, Parser, type Tree } from "web-tree-sitter";
import { beforeAll, describe, expect, it } from "vitest";
import { filterRefsByKind } from "./symbol-refs.js";
import { extractSymbolRefsJsTs } from "./tree-sitter-refs-js.js";
import { GRAMMAR_WASM_BY_LABEL, WEB_TREE_SITTER_WASM } from "./tree-sitter-test-paths.js";

let parser: Parser;
let jsParser: Parser;

beforeAll(async () => {
  await Parser.init({ locateFile: () => WEB_TREE_SITTER_WASM });
  parser = new Parser();
  parser.setLanguage(await Language.load(GRAMMAR_WASM_BY_LABEL.typescript));
  jsParser = new Parser();
  jsParser.setLanguage(await Language.load(GRAMMAR_WASM_BY_LABEL.javascript));
});

function parseTs(source: string): Tree {
  const tree = parser.parse(source);
  if (!tree) throw new Error("parse failed");
  return tree;
}

function parseJs(source: string): Tree {
  const tree = jsParser.parse(source);
  if (!tree) throw new Error("parse failed");
  return tree;
}

describe("extractSymbolRefsJsTs — imports", () => {
  it("extracts a default import", () => {
    const refs = extractSymbolRefsJsTs(parseTs(`import foo from "./a";`));
    expect(filterRefsByKind(refs, "import")).toEqual([
      {
        kind: "import",
        moduleSpecifier: "./a",
        importedNames: [{ local: "foo", imported: "default" }],
        startIndex: 0,
        endIndex: 22,
      },
    ]);
  });

  it("extracts named imports with aliases", () => {
    const refs = extractSymbolRefsJsTs(parseTs(`import { bar, baz as qux } from "./b";`));
    const imports = filterRefsByKind(refs, "import");
    expect(imports).toHaveLength(1);
    expect(imports[0]?.moduleSpecifier).toBe("./b");
    expect(imports[0]?.importedNames).toEqual([
      { local: "bar", imported: "bar" },
      { local: "qux", imported: "baz" },
    ]);
  });

  it("extracts namespace imports", () => {
    const refs = extractSymbolRefsJsTs(parseTs(`import * as ns from "./c";`));
    expect(filterRefsByKind(refs, "import")[0]?.importedNames).toEqual([
      { local: "ns", imported: "*" },
    ]);
  });

  it("extracts import type named imports", () => {
    const refs = extractSymbolRefsJsTs(parseTs(`import type { T } from "./d";`));
    expect(filterRefsByKind(refs, "import")[0]).toMatchObject({
      moduleSpecifier: "./d",
      importedNames: [{ local: "T", imported: "T" }],
    });
  });
});

describe("extractSymbolRefsJsTs — exports", () => {
  it("extracts declaration exports", () => {
    const refs = extractSymbolRefsJsTs(parseTs(`export function e() {}\nexport const x = 1;`));
    const exports = filterRefsByKind(refs, "export");
    expect(exports.map((e) => e.exportedNames)).toEqual([
      [{ exported: "e", local: "e" }],
      [{ exported: "x", local: "x" }],
    ]);
  });

  it("extracts re-exports with aliases", () => {
    const refs = extractSymbolRefsJsTs(parseTs(`export { e as f } from "./e";`));
    expect(filterRefsByKind(refs, "export")[0]).toMatchObject({
      moduleSpecifier: "./e",
      exportedNames: [{ exported: "f", local: "e" }],
    });
  });

  it("extracts export * from", () => {
    const refs = extractSymbolRefsJsTs(parseTs(`export * from "./f";`));
    expect(filterRefsByKind(refs, "export")[0]).toMatchObject({
      moduleSpecifier: "./f",
      exportedNames: [{ exported: "*" }],
    });
  });
});

describe("extractSymbolRefsJsTs — calls", () => {
  it("extracts bare calls, member calls, new, and nested calls", () => {
    const source = `foo(); obj.bar(); new Baz(); nested(a(b()));`;
    const refs = extractSymbolRefsJsTs(parseTs(source));
    const calls = filterRefsByKind(refs, "call");
    expect(calls.map((c) => ({ callee: c.calleeName, object: c.objectName }))).toEqual([
      { callee: "foo", object: undefined },
      { callee: "bar", object: "obj" },
      { callee: "Baz", object: undefined },
      { callee: "nested", object: undefined },
      { callee: "a", object: undefined },
      { callee: "b", object: undefined },
    ]);
  });

  it("finds calls inside exported function bodies", () => {
    const refs = extractSymbolRefsJsTs(
      parseTs(`export function run() { helper(); util.doThing(); }`),
    );
    const calls = filterRefsByKind(refs, "call");
    expect(calls.map((c) => c.calleeName)).toEqual(["helper", "doThing"]);
    expect(calls[1]?.objectName).toBe("util");
  });

  it("works on plain JavaScript grammar", () => {
    const refs = extractSymbolRefsJsTs(parseJs(`import x from "./m"; x();`));
    expect(filterRefsByKind(refs, "import")).toHaveLength(1);
    expect(filterRefsByKind(refs, "call")[0]?.calleeName).toBe("x");
  });
});
