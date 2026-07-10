import { describe, expect, it } from "vitest";
import { windowText } from "./text-window.js";

describe("windowText", () => {
  it("returns a requested one-based line range", () => {
    expect(windowText("one\ntwo\nthree\nfour", {
      startLine: 2,
      endLine: 3,
      maxChars: 100,
    })).toEqual({
      content: "two\nthree",
      startLine: 2,
      endLine: 3,
      totalLines: 4,
      truncated: false,
    });
  });

  it("enforces a character budget", () => {
    const result = windowText("0123456789\nsecond line", {
      startLine: 1,
      endLine: 2,
      maxChars: 8,
    });

    expect(result.content).toBe("0123456…");
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBe(8);
  });
});
