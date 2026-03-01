import { describe, it, expect } from "vitest";
import { chunkFile, rawTextStrategy } from "./chunker.js";

describe("chunkFile", () => {
  it("returns a single chunk for small content", () => {
    const chunks = chunkFile("src/index.ts", "const x = 1;");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("FILE: src/index.ts");
    expect(chunks[0].text).toContain("const x = 1;");
    expect(chunks[0].sourcePath).toBe("src/index.ts");
  });

  it("splits large content into multiple chunks", () => {
    const section = "a".repeat(800);
    const content = [section, section, section].join("\n\n");
    const chunks = chunkFile("big.ts", content, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].text).toContain("FILE: big.ts");
    expect(chunks[1].text).toContain("FILE: big.ts (continued)");
  });

  it("returns empty array for empty content", () => {
    const chunks = chunkFile("empty.ts", "");
    expect(chunks).toHaveLength(0);
  });

  it("returns empty array for whitespace-only content", () => {
    const chunks = chunkFile("blank.ts", "   \n\n  ");
    expect(chunks).toHaveLength(0);
  });

  it("returns empty for content that is only spaces (trim vs raw check)", () => {
    // " " is falsy after trim but truthy without trim
    // Catches: content.trim() → content mutation (MethodExpression)
    // Catches: if(false) mutation (ConditionalExpression)
    const spacesOnly = chunkFile("ws.ts", "   ");
    expect(spacesOnly).toHaveLength(0);
    // Verify non-empty content works (catches if(false) — always return [])
    const hasContent = chunkFile("ws.ts", "hello");
    expect(hasContent).toHaveLength(1);
  });

  it("preserves all content across chunks", () => {
    const section1 = "function foo() { return 1; }";
    const section2 = "function bar() { return 2; }";
    const section3 = "function baz() { return 3; }";
    const content = [section1, section2, section3].join("\n\n");
    const chunks = chunkFile("funcs.ts", content, 80);
    const allText = chunks.map((c) => c.text).join("\n");
    expect(allText).toContain(section1);
    expect(allText).toContain(section2);
    expect(allText).toContain(section3);
  });

  it("splits on double newlines, not single newlines", () => {
    const content = "line1\nline2\nline3";
    const chunks = chunkFile("single.ts", content, 2000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("line1\nline2\nline3");
  });

  it("chunk text is trimmed on mid-split chunks", () => {
    // Create content that forces a split, then verify intermediate chunks are trimmed
    const section = "a".repeat(800);
    const content = [section, section, section].join("\n\n");
    const chunks = chunkFile("trim.ts", content, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text).toBe(chunk.text.trim());
    }
  });

  it("joins sections with double newlines (not empty)", () => {
    // Two small sections — single chunk. The content should have \n\n between them.
    const content = "section1\n\nsection2";
    const chunks = chunkFile("join.ts", content, 5000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("section1\n\nsection2");
  });

  it("does NOT split when current + section equals maxChars exactly (> not >=)", () => {
    // header = "FILE: boundary.ts" → 17 chars
    // current starts as header + "\n\n" → 19 chars
    // After sec1(30) + "\n\n": 19 + 30 + 2 = 51 chars
    // sec2 = maxChars - 51 = 49 chars → total = 51 + 49 = 100 = maxChars exactly
    // With >: 100 > 100 is false → no split → 1 chunk
    // With >=: 100 >= 100 is true, AND 51 > 17 + 2 = 19 → split → 2 chunks
    const maxChars = 100;
    const sec1 = "a".repeat(30);
    const sec2 = "b".repeat(49);
    const content = [sec1, sec2].join("\n\n");
    const chunks = chunkFile("boundary.ts", content, maxChars);
    expect(chunks).toHaveLength(1);
  });

  it("does not split on first section even when oversized (requires content beyond header)", () => {
    // current starts at header.length + 2, so the "current has content" check is false
    const bigSection = "z".repeat(50);
    const content = [bigSection, "end"].join("\n\n");
    const chunks = chunkFile("first.ts", content, 30);
    expect(chunks[0].text).toContain("z".repeat(50));
  });

  it("does split on second section when current has content", () => {
    const sec1 = "a".repeat(20);
    const sec2 = "b".repeat(30);
    const content = [sec1, sec2].join("\n\n");
    const chunks = chunkFile("split2.ts", content, 60);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].text).toContain("a".repeat(20));
    expect(chunks[1].text).toContain("b".repeat(30));
  });

  it("all chunks have content beyond just the header", () => {
    // Three sections that each fill a chunk — no trailing empty chunk
    const maxChars = 80;
    const sec1 = "A".repeat(62);
    const sec2 = "B".repeat(50);
    const sec3 = "C".repeat(50);
    const content = [sec1, sec2, sec3].join("\n\n");
    const chunks = chunkFile("tail.ts", content, maxChars);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeGreaterThan("FILE: tail.ts (continued)".length);
    }
  });

  it("chunks are always trimmed (no leading/trailing whitespace)", () => {
    const sec1 = "X".repeat(40);
    const sec2 = "Y".repeat(40);
    const sec3 = "Z".repeat(40);
    const content = [sec1, sec2, sec3].join("\n\n");
    const chunks = chunkFile("hdr.ts", content, 60);
    expect(chunks.length).toBe(3);
    for (const chunk of chunks) {
      expect(chunk.text).toBe(chunk.text.trim());
    }
  });
});

describe("rawTextStrategy", () => {
  it("produces identical output to chunkFile", () => {
    const file = { path: "src/index.ts", content: "const x = 1;", sizeKb: 0.012 };
    const fromStrategy = rawTextStrategy(file);
    const fromChunkFile = chunkFile(file.path, file.content);
    expect(fromStrategy).toEqual(fromChunkFile);
  });

  it("returns empty array for empty content", () => {
    const file = { path: "empty.ts", content: "", sizeKb: 0 };
    expect(rawTextStrategy(file)).toEqual([]);
  });
});
