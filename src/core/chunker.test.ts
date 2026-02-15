import { describe, it, expect } from "vitest";
import { chunkFile } from "./chunker.js";

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
});
