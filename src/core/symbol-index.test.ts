import { describe, it, expect } from "vitest";
import {
  buildSymbolIndex,
  findDefinitions,
  indexLineAt,
  listSymbolsInFile,
  qualifiedNameFor,
  toSymbolLocation,
} from "./symbol-index.js";
import type { SymbolSpan } from "./tree-sitter-symbols.js";

const CONTENT = ["line1", "function foo() {}", "class Bar {", "  run() {}", "}", ""].join("\n");

function span(partial: Partial<SymbolSpan> & Pick<SymbolSpan, "kind" | "name">): SymbolSpan {
  return {
    startIndex: 0,
    endIndex: 1,
    ...partial,
  };
}

describe("indexLineAt", () => {
  it("returns 1 for the start of the file", () => {
    expect(indexLineAt(CONTENT, 0)).toBe(1);
  });

  it("counts newlines up to the index", () => {
    const idx = CONTENT.indexOf("function foo");
    expect(indexLineAt(CONTENT, idx)).toBe(2);
  });
});

describe("qualifiedNameFor", () => {
  it("returns bare name without className", () => {
    expect(qualifiedNameFor(span({ kind: "FUNCTION", name: "foo" }))).toBe("foo");
  });

  it("prefixes className for methods", () => {
    expect(qualifiedNameFor(span({ kind: "METHOD", name: "run", className: "Bar" }))).toBe("Bar.run");
  });
});

describe("buildSymbolIndex / findDefinitions / listSymbolsInFile", () => {
  const fooSpan = span({
    kind: "FUNCTION",
    name: "foo",
    startIndex: CONTENT.indexOf("function foo"),
    endIndex: CONTENT.indexOf("function foo") + "function foo() {}".length,
  });
  const barSpan = span({
    kind: "CLASS",
    name: "Bar",
    startIndex: CONTENT.indexOf("class Bar"),
    endIndex: CONTENT.length,
  });
  const runSpan = span({
    kind: "METHOD",
    name: "run",
    className: "Bar",
    startIndex: CONTENT.indexOf("run()"),
    endIndex: CONTENT.indexOf("run()") + "run() {}".length,
  });

  const index = buildSymbolIndex([
    { filePath: "src/a.ts", content: CONTENT, spans: [fooSpan, barSpan, runSpan] },
    {
      filePath: "src/b.ts",
      content: "function foo() {}",
      spans: [span({ kind: "FUNCTION", name: "foo", startIndex: 0, endIndex: 16 })],
    },
  ]);

  it("indexes all spans across files", () => {
    expect(index.symbols).toHaveLength(4);
  });

  it("findDefinitions returns all matches by bare name", () => {
    const hits = findDefinitions(index, "foo");
    const paths = hits.map((h) => h.filePath);
    // eslint-disable-next-line unicorn/no-array-sort -- Array#toSorted requires ES2023; project targets ES2022
    expect([...paths].sort((a, b) => a.localeCompare(b))).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("findDefinitions matches qualified method names", () => {
    const hits = findDefinitions(index, "Bar.run");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe("METHOD");
  });

  it("filters by kind, pathPrefix, and className", () => {
    expect(findDefinitions(index, "foo", { kind: "CLASS" })).toEqual([]);
    expect(findDefinitions(index, "foo", { pathPrefix: "src/b" })).toHaveLength(1);
    expect(findDefinitions(index, "run", { className: "Bar" })).toHaveLength(1);
  });

  it("listSymbolsInFile returns a stable sort", () => {
    const listed = listSymbolsInFile(index, "src/a.ts");
    expect(listed.map((s) => `${s.kind}:${s.name}`)).toEqual([
      "CLASS:Bar",
      "FUNCTION:foo",
      "METHOD:run",
    ]);
  });

  it("toSymbolLocation fills line numbers", () => {
    const loc = toSymbolLocation("src/a.ts", CONTENT, fooSpan);
    expect(loc.startLine).toBe(2);
    expect(loc.qualifiedName).toBe("foo");
  });
});
