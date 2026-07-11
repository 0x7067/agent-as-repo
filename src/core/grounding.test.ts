import { describe, it, expect } from "vitest";
import { groundFileReferences, indexedPathsFromPassages } from "./grounding.js";

describe("indexedPathsFromPassages", () => {
  it("extracts file paths from FILE: headers", () => {
    const passages = [
      { text: "FILE: src/core/onboard.ts\n\nexport function foo() {}" },
      { text: "FILE: src/shell/bootstrap.ts\n\nexport function bar() {}" },
    ];
    const paths = indexedPathsFromPassages(passages);
    expect(paths.has("src/core/onboard.ts")).toBe(true);
    expect(paths.has("src/shell/bootstrap.ts")).toBe(true);
    expect(paths.size).toBe(2);
  });

  it("skips passages without a FILE: header", () => {
    const passages = [{ text: "just some manually inserted note" }];
    const paths = indexedPathsFromPassages(passages);
    expect(paths.size).toBe(0);
  });

  it("dedupes repeated paths from continued chunks", () => {
    const passages = [
      { text: "FILE: src/core/onboard.ts\n\nchunk 1" },
      { text: "FILE: src/core/onboard.ts (continued)\n\nchunk 2" },
    ];
    const paths = indexedPathsFromPassages(passages);
    expect(paths.size).toBe(1);
    expect(paths.has("src/core/onboard.ts")).toBe(true);
  });

  it("returns an empty set for an empty passage list", () => {
    expect(indexedPathsFromPassages([]).size).toBe(0);
  });
});

describe("groundFileReferences", () => {
  it("leaves a line whose backtick file path is indexed unchanged", () => {
    const indexed = new Set(["src/core/onboard.ts"]);
    const text = "- `src/core/onboard.ts` — builds the onboarding prompt";
    const result = groundFileReferences(text, indexed);
    expect(result.text).toBe(text);
    expect(result.changed).toBe(false);
    expect(result.droppedPaths).toEqual([]);
  });

  it("strips a path/to/ template prefix and re-validates against the index", () => {
    const indexed = new Set(["src/core/onboard.ts"]);
    const text = "- `path/to/src/core/onboard.ts` — builds the onboarding prompt";
    const result = groundFileReferences(text, indexed);
    expect(result.text).toBe("- `src/core/onboard.ts` — builds the onboarding prompt");
    expect(result.changed).toBe(true);
  });

  it("drops a whole line whose referenced path is not in the index", () => {
    const indexed = new Set(["src/core/onboard.ts"]);
    const text = [
      "- `src/core/onboard.ts` — builds the onboarding prompt",
      "- `lib/router/index.js` — internal router dispatch",
    ].join("\n");
    const result = groundFileReferences(text, indexed);
    expect(result.text).toBe("- `src/core/onboard.ts` — builds the onboarding prompt");
    expect(result.changed).toBe(true);
    expect(result.droppedPaths).toEqual(["lib/router/index.js"]);
  });

  it("drops a line whose path/to/-prefixed reference still doesn't resolve after stripping", () => {
    const indexed = new Set(["src/core/onboard.ts"]);
    const text = "- `path/to/flask/create.py` — scaffolding command";
    const result = groundFileReferences(text, indexed);
    expect(result.text).toBe("");
    expect(result.changed).toBe(true);
    expect(result.droppedPaths).toEqual(["path/to/flask/create.py"]);
  });

  it("leaves prose lines with no path-like backtick tokens unchanged", () => {
    const indexed = new Set<string>();
    const text = "This project uses `express` for routing.";
    const result = groundFileReferences(text, indexed);
    expect(result.text).toBe(text);
    expect(result.changed).toBe(false);
  });

  it("does not validate bare directory mentions (no slash-quoted path)", () => {
    const indexed = new Set<string>();
    const text = "The architecture keeps tests under /tests and middleware under /middleware.";
    const result = groundFileReferences(text, indexed);
    expect(result.text).toBe(text);
    expect(result.changed).toBe(false);
  });

  it("preserves line order and only removes the offending lines", () => {
    const indexed = new Set(["a/one.ts", "b/two.ts"]);
    const text = [
      "intro line",
      "- `a/one.ts` good",
      "- `nope/three.ts` bad",
      "- `b/two.ts` good",
      "outro line",
    ].join("\n");
    const result = groundFileReferences(text, indexed);
    expect(result.text).toBe(
      ["intro line", "- `a/one.ts` good", "- `b/two.ts` good", "outro line"].join("\n"),
    );
  });

  it("is a no-op returning changed:false when every reference resolves", () => {
    const indexed = new Set(["a/one.ts"]);
    const text = "See `a/one.ts` for details.";
    const result = groundFileReferences(text, indexed);
    expect(result.changed).toBe(false);
    expect(result.text).toBe(text);
  });
});
