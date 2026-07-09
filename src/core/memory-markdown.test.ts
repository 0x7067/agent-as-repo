import { describe, expect, it } from "vitest";
import { formatMemoryBlockMarkdown, parseMemoryBlockMarkdown } from "./memory-markdown.js";

describe("memory-markdown", () => {
  it("round-trips frontmatter and body", () => {
    const md = formatMemoryBlockMarkdown({
      label: "architecture",
      value: "Uses sqlite-vec.",
      updatedAt: "2026-07-09T00:00:00.000Z",
      sourceCommit: "abc123",
    });
    expect(md).toContain("label: architecture");
    expect(md).toContain("Uses sqlite-vec.");
    const parsed = parseMemoryBlockMarkdown(md, "architecture");
    expect(parsed).toEqual({
      label: "architecture",
      value: "Uses sqlite-vec.",
      updatedAt: "2026-07-09T00:00:00.000Z",
      sourceCommit: "abc123",
    });
  });

  it("parses body-only files", () => {
    expect(parseMemoryBlockMarkdown("plain text\n", "persona")).toEqual({
      label: "persona",
      value: "plain text",
    });
  });
});
