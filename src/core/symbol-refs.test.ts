import { describe, expect, it } from "vitest";
import {
  filterRefsByKind,
  isCallRef,
  isExportRef,
  isImportRef,
  type CallRef,
  type ExportRef,
  type ImportRef,
  type SymbolRef,
} from "./symbol-refs.js";

const importRef: ImportRef = {
  kind: "import",
  moduleSpecifier: "./a",
  importedNames: [{ local: "foo", imported: "default" }],
  startIndex: 0,
  endIndex: 10,
};

const exportRef: ExportRef = {
  kind: "export",
  exportedNames: [{ exported: "bar" }],
  startIndex: 0,
  endIndex: 10,
};

const callRef: CallRef = {
  kind: "call",
  calleeName: "baz",
  startIndex: 0,
  endIndex: 5,
};

describe("symbol-refs type guards", () => {
  it("narrows import / export / call refs", () => {
    expect(isImportRef(importRef)).toBe(true);
    expect(isExportRef(importRef)).toBe(false);
    expect(isCallRef(callRef)).toBe(true);
    expect(isExportRef(exportRef)).toBe(true);
  });

  it("filterRefsByKind returns only matching refs", () => {
    const refs: SymbolRef[] = [importRef, exportRef, callRef];
    expect(filterRefsByKind(refs, "import")).toEqual([importRef]);
    expect(filterRefsByKind(refs, "call")).toEqual([callRef]);
    expect(filterRefsByKind(refs, "export")).toHaveLength(1);
  });
});
