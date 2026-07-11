import { describe, it, expect } from "vitest";
import { extractPassagePath, extractPassageSnippet, formatRetrievedPassages } from "./retrieved-passages.js";

describe("extractPassagePath", () => {
  it("extracts the path from a FILE: header line", () => {
    expect(extractPassagePath("FILE: src/auth/session.ts\nconst x = 1;")).toBe("src/auth/session.ts");
  });

  it("strips a trailing (continued) suffix", () => {
    expect(extractPassagePath("FILE: src/big.ts (continued)\nmore content")).toBe("src/big.ts");
  });

  it("returns null when there is no FILE: header", () => {
    expect(extractPassagePath("just some text")).toBeNull();
  });
});

describe("extractPassageSnippet", () => {
  it("returns the body with the FILE: header line stripped", () => {
    expect(extractPassageSnippet("FILE: src/a.ts\nconst x = 1;")).toBe("const x = 1;");
  });

  it("collapses internal newlines/whitespace into single spaces", () => {
    expect(extractPassageSnippet("FILE: src/a.ts\nline one\nline two")).toBe("line one line two");
  });

  it("truncates long bodies with an ellipsis", () => {
    const body = "x".repeat(200);
    const snippet = extractPassageSnippet(`FILE: src/a.ts\n${body}`, 20);
    expect(snippet).toBe(`${"x".repeat(20)}…`);
  });

  it("keeps the whole body when there is no FILE: header to strip", () => {
    expect(extractPassageSnippet("no header here")).toBe("no header here");
  });
});

describe("formatRetrievedPassages", () => {
  it("reports 'none' when no passages were retrieved", () => {
    expect(formatRetrievedPassages([])).toBe("Retrieved passages: none.");
  });

  it("lists path, snippet, and score for each passage", () => {
    const output = formatRetrievedPassages([
      { id: "p-1", text: "FILE: src/auth.ts\nfunction login() {}", score: 0.873 },
      { id: "p-2", text: "FILE: src/db.ts\nfunction connect() {}", score: 0.412 },
    ]);

    expect(output).toContain("Retrieved passages (2):");
    expect(output).toContain("1. src/auth.ts score=0.873");
    expect(output).toContain("function login() {}");
    expect(output).toContain("2. src/db.ts score=0.412");
    expect(output).toContain("function connect() {}");
  });

  it("omits the score suffix when score is undefined", () => {
    const output = formatRetrievedPassages([{ id: "p-1", text: "FILE: src/auth.ts\nfunction login() {}" }]);
    expect(output).toContain("1. src/auth.ts\n");
    expect(output).not.toContain("score=");
  });

  it("falls back to '(unknown file)' when a passage has no FILE: header", () => {
    const output = formatRetrievedPassages([{ id: "p-1", text: "some note without a header" }]);
    expect(output).toContain("(unknown file)");
  });
});
