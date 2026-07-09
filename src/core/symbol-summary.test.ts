import { describe, expect, it } from "vitest";
import { formatTopSymbolsEvidence } from "./symbol-summary.js";
import type { SymbolFileMap, SymbolRankMap } from "./symbol-store.js";

describe("formatTopSymbolsEvidence", () => {
  it("returns empty string when ranks or files missing", () => {
    expect(formatTopSymbolsEvidence(undefined, {})).toBe("");
    expect(formatTopSymbolsEvidence({}, undefined)).toBe("");
  });

  it("lists top-ranked definitions", () => {
    const symbolFiles: SymbolFileMap = {
      "src/lib.ts": {
        symbols: [
          {
            kind: "FUNCTION",
            name: "helper",
            qualifiedName: "helper",
            startIndex: 0,
            endIndex: 10,
            startLine: 1,
            endLine: 1,
          },
        ],
        refs: [],
      },
      "src/lonely.ts": {
        symbols: [
          {
            kind: "FUNCTION",
            name: "lonely",
            qualifiedName: "lonely",
            startIndex: 0,
            endIndex: 10,
            startLine: 1,
            endLine: 1,
          },
        ],
        refs: [],
      },
    };
    const ranks: SymbolRankMap = {
      "def:src/lib.ts#helper@1": 0.4,
      "def:src/lonely.ts#lonely@1": 0.05,
    };
    const text = formatTopSymbolsEvidence(symbolFiles, ranks, { maxEntries: 10 });
    expect(text).toContain("FUNCTION helper @ src/lib.ts");
    expect(text.indexOf("helper")).toBeLessThan(text.indexOf("lonely"));
  });
});
