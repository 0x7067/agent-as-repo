import { describe, expect, it } from "vitest";
import { buildFileContext, enrichChunks } from "./chunk-context.js";
import type { Chunk } from "./types.js";
import type { SymbolRef } from "./symbol-refs.js";

const importRef = (
  moduleSpecifier: string,
  importedNames: { local: string; imported: string }[],
): SymbolRef => ({
  kind: "import",
  moduleSpecifier,
  importedNames,
  startIndex: 0,
  endIndex: 0,
});

const exportRef = (exportedNames: { exported: string; local?: string }[]): SymbolRef => ({
  kind: "export",
  exportedNames,
  startIndex: 0,
  endIndex: 0,
});

describe("buildFileContext", () => {
  it("summarizes imported symbol names and module basenames", () => {
    const context = buildFileContext([
      importRef("react", [{ local: "useState", imported: "useState" }]),
      importRef("./auth/session", [{ local: "getSession", imported: "getSession" }]),
    ]);
    expect(context).not.toBeNull();
    expect(context).toContain("imports:");
    expect(context).toContain("useState");
    expect(context).toContain("getSession");
    // Module basenames give topical signal even when the imported names are terse.
    expect(context).toContain("react");
    expect(context).toContain("session");
  });

  it("uses the local binding name for default and namespace imports", () => {
    const context = buildFileContext([
      importRef("express", [{ local: "express", imported: "default" }]),
      importRef("./ns", [{ local: "utils", imported: "*" }]),
    ]);
    expect(context).toContain("express");
    expect(context).toContain("utils");
    // The synthetic "default"/"*" markers must not leak into the summary.
    expect(context).not.toContain("default");
    expect(context).not.toContain("*");
  });

  it("summarizes exported names and skips star re-exports", () => {
    const context = buildFileContext([
      exportRef([{ exported: "syncRepo" }, { exported: "SyncResult" }]),
      exportRef([{ exported: "*" }]),
    ]);
    expect(context).toContain("exports:");
    expect(context).toContain("syncRepo");
    expect(context).toContain("SyncResult");
  });

  it("returns null when there are no import or export refs", () => {
    expect(buildFileContext([])).toBeNull();
    expect(
      buildFileContext([
        { kind: "call", calleeName: "foo", startIndex: 0, endIndex: 0 },
      ]),
    ).toBeNull();
  });

  it("is deterministic (sorted) and bounded in length", () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      importRef(`./mod${String(i)}`, [
        { local: `sym${String(i)}`, imported: `sym${String(i)}` },
      ]),
    );
    const a = buildFileContext(many);
    // eslint-disable-next-line unicorn/no-array-reverse -- Array#toReversed requires ES2023; project targets ES2022
    const b = buildFileContext([...many].reverse());
    expect(a).toEqual(b);
    expect((a ?? "").length).toBeLessThanOrEqual(300);
  });
});

const chunk = (text: string): Chunk => ({ text, sourcePath: "src/foo.ts" });

describe("enrichChunks", () => {
  it("inserts the context on the second line, preserving the FILE header as line one", () => {
    const refs = [importRef("react", [{ local: "useState", imported: "useState" }])];
    const [enriched] = enrichChunks(
      [chunk("FILE: src/foo.ts | FUNCTION: bar\n\nconst bar = () => {}")],
      refs,
    );
    const lines = enriched.text.split("\n");
    expect(lines[0]).toBe("FILE: src/foo.ts | FUNCTION: bar");
    expect(lines[1]).toContain("imports:");
    // Body survives intact after the context line.
    expect(enriched.text).toContain("const bar = () => {}");
    expect(enriched.sourcePath).toBe("src/foo.ts");
  });

  it("returns chunks unchanged when there is no file-local context", () => {
    const chunks = [chunk("FILE: src/foo.ts\n\nbody")];
    expect(enrichChunks(chunks, [])).toEqual(chunks);
  });

  it("applies the same file context to every chunk of the file", () => {
    const refs = [exportRef([{ exported: "syncRepo" }])];
    const enriched = enrichChunks(
      [chunk("FILE: src/foo.ts | FUNCTION: a\n\na"), chunk("FILE: src/foo.ts (continued)\n\nb")],
      refs,
    );
    expect(enriched.every((c) => c.text.includes("syncRepo"))).toBe(true);
  });

  it("skips enrichment when the context would push the chunk past the size budget", () => {
    const refs = [importRef("react", [{ local: "useState", imported: "useState" }])];
    const body = "x".repeat(1995);
    const original = `FILE: src/foo.ts\n\n${body}`; // ~2013 chars, already near the cap
    const [enriched] = enrichChunks([chunk(original)], refs, 2000);
    // No room for the context line: chunk returned unchanged, never ballooned.
    expect(enriched.text).toBe(original);
  });

  it("keeps every enriched chunk within the size budget", () => {
    const refs = Array.from({ length: 40 }, (_, i) =>
      importRef(`./m${String(i)}`, [{ local: `longSymbolName${String(i)}`, imported: `longSymbolName${String(i)}` }]),
    );
    const chunks = [chunk(`FILE: src/foo.ts\n\n${"y".repeat(1850)}`)];
    const [enriched] = enrichChunks(chunks, refs, 2000);
    expect(enriched.text.length).toBeLessThanOrEqual(2000);
  });

  it("leaves a passage without a FILE header untouched (self-enforced contract)", () => {
    const refs = [importRef("react", [{ local: "useState", imported: "useState" }])];
    expect(enrichChunks([chunk("")], refs)[0]?.text).toBe("");
    expect(enrichChunks([chunk("no header here\n\nbody")], refs)[0]?.text).toBe(
      "no header here\n\nbody",
    );
  });

  it("normalizes backslash module specifiers to a clean basename", () => {
    const context = buildFileContext([
      importRef(String.raw`..\utils\helpers.js`, [{ local: "help", imported: "help" }]),
    ]);
    expect(context).toContain("helpers");
    expect(context).not.toContain("\\");
  });
});
