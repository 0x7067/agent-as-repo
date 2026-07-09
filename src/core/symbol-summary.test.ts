import { describe, expect, it } from "vitest";
import { formatTopSymbolsEvidence } from "./symbol-summary.js";
import type { SymbolFileMap, SymbolRankMap } from "./symbol-store.js";

describe("formatTopSymbolsEvidence", () => {
  it("returns empty string when ranks or files missing", () => {
    const missingRanks: SymbolRankMap | undefined = undefined;
    const missingFiles: SymbolFileMap | undefined = undefined;
    expect(formatTopSymbolsEvidence(missingFiles, {})).toBe("");
    expect(formatTopSymbolsEvidence({}, missingRanks)).toBe("");
  });

  it("lists top-ranked definitions with scores", () => {
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
    expect(text).toContain("FUNCTION helper @ src/lib.ts (0.4000)");
    expect(text.indexOf("helper")).toBeLessThan(text.indexOf("lonely"));
  });

  it("omits definitions missing from the rank map", () => {
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
          {
            kind: "FUNCTION",
            name: "unused",
            qualifiedName: "unused",
            startIndex: 20,
            endIndex: 30,
            startLine: 2,
            endLine: 2,
          },
        ],
        refs: [],
      },
    };
    const ranks: SymbolRankMap = { "def:src/lib.ts#helper@1": 0.4 };
    const text = formatTopSymbolsEvidence(symbolFiles, ranks);
    expect(text).toContain("helper");
    expect(text).not.toContain("unused");
  });

  it("respects minScore and maxEntries", () => {
    const symbolFiles: SymbolFileMap = {
      "src/a.ts": {
        symbols: [
          {
            kind: "FUNCTION",
            name: "a",
            qualifiedName: "a",
            startIndex: 0,
            endIndex: 1,
            startLine: 1,
            endLine: 1,
          },
        ],
        refs: [],
      },
      "src/b.ts": {
        symbols: [
          {
            kind: "FUNCTION",
            name: "b",
            qualifiedName: "b",
            startIndex: 0,
            endIndex: 1,
            startLine: 1,
            endLine: 1,
          },
        ],
        refs: [],
      },
    };
    const ranks: SymbolRankMap = {
      "def:src/a.ts#a@1": 0.5,
      "def:src/b.ts#b@1": 0.01,
    };
    expect(formatTopSymbolsEvidence(symbolFiles, ranks, { minScore: 0.1 })).not.toContain("b @");
    expect(formatTopSymbolsEvidence(symbolFiles, ranks, { maxEntries: 1 })).not.toContain("b @");
  });
});
