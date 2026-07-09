import { describe, expect, it } from "vitest";
import { buildSymbolIndex, type SymbolIndex } from "./symbol-index.js";
import {
  buildSymbolGraph,
  definitionNodeId,
  fileNodeId,
  resolveModuleSpecifier,
  resolvePythonRelativeModule,
  resolveRelativeModule,
} from "./symbol-graph.js";
import type { SymbolRef } from "./symbol-refs.js";
import type { SymbolSpan } from "./tree-sitter-symbols.js";

function span(partial: Partial<SymbolSpan> & Pick<SymbolSpan, "kind" | "name">): SymbolSpan {
  return { startIndex: 0, endIndex: 1, ...partial };
}

function indexFrom(
  files: Array<{ filePath: string; spans: SymbolSpan[] }>,
): SymbolIndex {
  return buildSymbolIndex(
    files.map((f) => ({ filePath: f.filePath, content: "x", spans: f.spans })),
  );
}

describe("resolveRelativeModule", () => {
  const known = new Set(["src/lib.ts", "src/utils/index.ts", "src/a.js"]);

  it("resolves ./lib against src/use.ts to src/lib.ts", () => {
    expect(resolveRelativeModule("src/use.ts", "./lib", known)).toBe("src/lib.ts");
  });

  it("resolves ../utils to index.ts", () => {
    expect(resolveRelativeModule("src/nested/x.ts", "../utils", known)).toBe("src/utils/index.ts");
  });

  it("returns undefined for bare package specifiers", () => {
    expect(resolveRelativeModule("src/use.ts", "lodash", known)).toBeUndefined();
    expect(resolveRelativeModule("src/use.ts", "node:fs", known)).toBeUndefined();
  });
});

describe("resolveModuleSpecifier with path aliases", () => {
  it("resolves @app/* aliases against known files", () => {
    const known = new Set(["src/app/auth.ts"]);
    expect(
      resolveModuleSpecifier("src/use.ts", "@app/auth", known, {
        baseUrl: ".",
        paths: [{ pattern: "@app/*", targets: ["src/app/*"] }],
      }),
    ).toBe("src/app/auth.ts");
  });
});

describe("resolvePythonRelativeModule", () => {
  it("resolves .foo from a package file", () => {
    const known = new Set(["pkg/foo.py", "pkg/__init__.py"]);
    expect(resolvePythonRelativeModule("pkg/bar.py", ".foo", known)).toBe("pkg/foo.py");
  });
});

describe("buildSymbolGraph", () => {
  it("creates import edges from importer file to exported definitions", () => {
    const index = indexFrom([
      { filePath: "src/lib.ts", spans: [span({ kind: "FUNCTION", name: "helper" })] },
      { filePath: "src/use.ts", spans: [span({ kind: "FUNCTION", name: "run" })] },
    ]);
    const libExports: SymbolRef[] = [
      {
        kind: "export",
        exportedNames: [{ exported: "helper", local: "helper" }],
        startIndex: 0,
        endIndex: 10,
      },
    ];
    const useImports: SymbolRef[] = [
      {
        kind: "import",
        moduleSpecifier: "./lib",
        importedNames: [{ local: "helper", imported: "helper" }],
        startIndex: 0,
        endIndex: 10,
      },
    ];

    const graph = buildSymbolGraph({
      index,
      files: [
        { filePath: "src/lib.ts", refs: libExports },
        { filePath: "src/use.ts", refs: useImports },
      ],
    });

    const helper = index.symbols.find((s) => s.name === "helper");
    expect(helper).toBeDefined();
    if (helper === undefined) return;
    expect(graph.edges).toContainEqual({
      from: fileNodeId("src/use.ts"),
      to: definitionNodeId(helper),
      kind: "import",
    });
  });

  it("creates call edges to same-file and imported definitions", () => {
    const index = indexFrom([
      { filePath: "src/lib.ts", spans: [span({ kind: "FUNCTION", name: "helper" })] },
      {
        filePath: "src/use.ts",
        spans: [
          span({ kind: "FUNCTION", name: "run" }),
          span({ kind: "FUNCTION", name: "local" }),
        ],
      },
    ]);
    const refs: SymbolRef[] = [
      {
        kind: "import",
        moduleSpecifier: "./lib",
        importedNames: [{ local: "helper", imported: "helper" }],
        startIndex: 0,
        endIndex: 10,
      },
      { kind: "call", calleeName: "helper", startIndex: 20, endIndex: 28 },
      { kind: "call", calleeName: "local", startIndex: 30, endIndex: 37 },
    ];

    const graph = buildSymbolGraph({
      index,
      files: [
        { filePath: "src/lib.ts", refs: [] },
        { filePath: "src/use.ts", refs: refs },
      ],
    });

    const helper = index.symbols.find((s) => s.name === "helper");
    const local = index.symbols.find((s) => s.name === "local");
    expect(helper).toBeDefined();
    expect(local).toBeDefined();
    if (helper === undefined || local === undefined) return;
    const callEdges = graph.edges.filter((e) => e.kind === "call");
    expect(callEdges).toContainEqual({
      from: fileNodeId("src/use.ts"),
      to: definitionNodeId(helper),
      kind: "call",
    });
    expect(callEdges).toContainEqual({
      from: fileNodeId("src/use.ts"),
      to: definitionNodeId(local),
      kind: "call",
    });
  });

  it("over-connects ambiguous bare call names to all definitions", () => {
    const index = indexFrom([
      { filePath: "src/a.ts", spans: [span({ kind: "FUNCTION", name: "foo" })] },
      { filePath: "src/b.ts", spans: [span({ kind: "FUNCTION", name: "foo" })] },
      { filePath: "src/c.ts", spans: [span({ kind: "FUNCTION", name: "run" })] },
    ]);
    const graph = buildSymbolGraph({
      index,
      files: [
        { filePath: "src/a.ts", refs: [] },
        { filePath: "src/b.ts", refs: [] },
        {
          filePath: "src/c.ts",
          refs: [{ kind: "call", calleeName: "foo", startIndex: 0, endIndex: 5 }],
        },
      ],
    });
    const callTargets = graph.edges.filter((e) => e.kind === "call").map((e) => e.to);
    expect(callTargets).toHaveLength(2);
  });

  it("skips non-relative imports without creating edges", () => {
    const index = indexFrom([
      { filePath: "src/use.ts", spans: [span({ kind: "FUNCTION", name: "run" })] },
    ]);
    const graph = buildSymbolGraph({
      index,
      files: [
        {
          filePath: "src/use.ts",
          refs: [
            {
              kind: "import",
              moduleSpecifier: "lodash",
              importedNames: [{ local: "get", imported: "get" }],
              startIndex: 0,
              endIndex: 10,
            },
          ],
        },
      ],
    });
    expect(graph.edges.filter((e) => e.kind === "import")).toHaveLength(0);
  });

  it("creates import edges for tsconfig path aliases", () => {
    const index = indexFrom([
      { filePath: "src/app/auth.ts", spans: [span({ kind: "FUNCTION", name: "login" })] },
      { filePath: "src/use.ts", spans: [span({ kind: "FUNCTION", name: "run" })] },
    ]);
    const graph = buildSymbolGraph({
      index,
      pathAliases: {
        baseUrl: ".",
        paths: [{ pattern: "@app/*", targets: ["src/app/*"] }],
      },
      files: [
        {
          filePath: "src/app/auth.ts",
          refs: [
            {
              kind: "export",
              exportedNames: [{ exported: "login", local: "login" }],
              startIndex: 0,
              endIndex: 10,
            },
          ],
        },
        {
          filePath: "src/use.ts",
          refs: [
            {
              kind: "import",
              moduleSpecifier: "@app/auth",
              importedNames: [{ local: "login", imported: "login" }],
              startIndex: 0,
              endIndex: 10,
            },
          ],
        },
      ],
    });
    const login = index.symbols.find((s) => s.name === "login");
    expect(login).toBeDefined();
    if (login === undefined) return;
    expect(graph.edges).toContainEqual({
      from: fileNodeId("src/use.ts"),
      to: definitionNodeId(login),
      kind: "import",
    });
  });
});

describe("resolveRelativeModule Go", () => {
  it("resolves relative Go imports to .go files", () => {
    const known = new Set(["pkg/foo.go", "pkg/bar.go"]);
    expect(resolveRelativeModule("pkg/bar.go", "./foo", known)).toBe("pkg/foo.go");
  });
});
