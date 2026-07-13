import { describe, it, expect } from "vitest";
import { DEFAULT_IDS, parseArgs } from "./dump-legs.js";

describe("dump-legs parseArgs", () => {
  it("defaults to transformersjs and the class-(a) query set", () => {
    expect(parseArgs([])).toEqual({ engine: "transformersjs", ids: DEFAULT_IDS });
  });

  it("accepts each known engine", () => {
    for (const engine of ["deterministic", "transformersjs", "http"]) {
      expect(parseArgs(["--engine", engine]).engine).toBe(engine);
    }
  });

  it("rejects --engine with no value instead of silently using the stub", () => {
    expect(() => parseArgs(["--engine"])).toThrow(/requires one of/);
  });

  it("rejects an unknown engine name", () => {
    expect(() => parseArgs(["--engine", "openai"])).toThrow(/requires one of/);
  });

  it("parses --ids as a trimmed comma-separated list", () => {
    expect(parseArgs(["--ids", " a , b ,c"]).ids).toEqual(["a", "b", "c"]);
  });

  it("rejects --ids with no value instead of matching nothing", () => {
    expect(() => parseArgs(["--ids"])).toThrow(/comma-separated/);
    expect(() => parseArgs(["--ids", ","])).toThrow(/comma-separated/);
  });
});
