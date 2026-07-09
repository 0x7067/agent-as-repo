import { describe, expect, it } from "vitest";
import {
  buildSymbolIndexFromStored,
  computeSymbolRanks,
  findRankedSymbols,
  toStoredSymbolFile,
  type SymbolFileMap,
} from "./symbol-store.js";
import type { SymbolRef } from "./symbol-refs.js";
import type { SymbolSpan } from "./tree-sitter-symbols.js";

const helperSpan: SymbolSpan = {
  kind: "FUNCTION",
  name: "helper",
  startIndex: 0,
  endIndex: 20,
};

const runSpan: SymbolSpan = {
  kind: "FUNCTION",
  name: "run",
  startIndex: 0,
  endIndex: 10,
};

describe("toStoredSymbolFile / buildSymbolIndexFromStored", () => {
  it("round-trips definitions with line numbers", () => {
    const content = "function helper() {}\n";
    const stored = toStoredSymbolFile("src/lib.ts", content, [helperSpan], []);
    expect(stored.symbols[0]).toMatchObject({
      name: "helper",
      qualifiedName: "helper",
      startLine: 1,
      endLine: 1,
    });
    const index = buildSymbolIndexFromStored({ "src/lib.ts": stored });
    expect(index.symbols).toHaveLength(1);
    expect(index.symbols[0]?.filePath).toBe("src/lib.ts");
  });
});

describe("computeSymbolRanks / findRankedSymbols", () => {
  it("ranks a heavily imported symbol higher and sorts find results by rank", () => {
    const libRefs: SymbolRef[] = [
      {
        kind: "export",
        exportedNames: [{ exported: "helper", local: "helper" }],
        startIndex: 0,
        endIndex: 10,
      },
    ];
    const useRefs: SymbolRef[] = [
      {
        kind: "import",
        moduleSpecifier: "./lib",
        importedNames: [{ local: "helper", imported: "helper" }],
        startIndex: 0,
        endIndex: 10,
      },
      { kind: "call", calleeName: "helper", startIndex: 20, endIndex: 28 },
    ];
    const otherRefs: SymbolRef[] = [
      {
        kind: "import",
        moduleSpecifier: "./lib",
        importedNames: [{ local: "helper", imported: "helper" }],
        startIndex: 0,
        endIndex: 10,
      },
    ];

    const symbolFiles: SymbolFileMap = {
      "src/lib.ts": toStoredSymbolFile("src/lib.ts", "function helper() {}", [helperSpan], libRefs),
      "src/use.ts": toStoredSymbolFile("src/use.ts", "function run() {}", [runSpan], useRefs),
      "src/other.ts": toStoredSymbolFile(
        "src/other.ts",
        "function run() {}",
        [{ kind: "FUNCTION", name: "run", startIndex: 0, endIndex: 10 }],
        otherRefs,
      ),
    };

    // Ambiguous: another helper elsewhere with no inbound edges
    symbolFiles["src/lonely.ts"] = toStoredSymbolFile(
      "src/lonely.ts",
      "function helper() {}",
      [helperSpan],
      [],
    );

    const ranks = computeSymbolRanks(symbolFiles);
    const index = buildSymbolIndexFromStored(symbolFiles);
    const hits = findRankedSymbols(index, "helper", ranks);
    expect(hits).toHaveLength(2);
    expect(hits[0]?.filePath).toBe("src/lib.ts");
    expect(hits[0]!.rank).toBeGreaterThan(hits[1]!.rank);
  });
});
