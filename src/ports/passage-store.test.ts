import { describe, it, expect } from "vitest";

describe("PassageStore port", () => {
  it("can be imported from src/ports/passage-store", async () => {
    const mod = await import("./passage-store.js");
    expect(mod).toBeDefined();
  });
});
