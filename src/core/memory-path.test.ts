import { describe, expect, it } from "vitest";
import { assertSafeMemorySegment, resolveSafeMemoryPath } from "./memory-path.js";

describe("assertSafeMemorySegment", () => {
  it("accepts simple ids and labels", () => {
    expect(assertSafeMemorySegment("my-app", "agentId")).toBe("my-app");
    expect(assertSafeMemorySegment("architecture", "label")).toBe("architecture");
  });

  it("rejects traversal and separators", () => {
    expect(() => assertSafeMemorySegment("../outside", "label")).toThrow(/separators|invalid/i);
    expect(() => assertSafeMemorySegment("a/b", "label")).toThrow(/separators/i);
    expect(() => assertSafeMemorySegment("..", "agentId")).toThrow(/\.\./);
    expect(() => assertSafeMemorySegment("", "label")).toThrow(/required/i);
  });
});

describe("resolveSafeMemoryPath", () => {
  it("resolves under the memory root", () => {
    expect(resolveSafeMemoryPath("/mem", "myrepo")).toBe("/mem/myrepo");
    expect(resolveSafeMemoryPath("/mem", "myrepo", "architecture.md")).toBe(
      "/mem/myrepo/architecture.md",
    );
  });

  it("rejects escaping segments", () => {
    expect(() => resolveSafeMemoryPath("/mem", "../outside")).toThrow(/separators|rejects/i);
    expect(() => resolveSafeMemoryPath("/mem", "ok", "../../x.md")).toThrow(/separators|rejects|invalid/i);
  });
});
