import { describe, expect, it } from "vitest";
import { prepareJsonc, stripJsoncComments, stripTrailingCommas } from "./jsonc.js";

describe("jsonc helpers", () => {
  it("strips line and block comments", () => {
    const raw = `{
  // comment
  "a": 1 /* block */,
  "b": "https://example.com/x" // keep url
}`;
    expect(JSON.parse(prepareJsonc(raw))).toEqual({ a: 1, b: "https://example.com/x" });
  });

  it("strips trailing commas", () => {
    expect(JSON.parse(stripTrailingCommas('{"a":1,}'))).toEqual({ a: 1 });
    expect(JSON.parse(stripTrailingCommas('{"a":[1,2,],}'))).toEqual({ a: [1, 2] });
  });

  it("prepareJsonc handles comments + trailing commas together", () => {
    const raw = `{
  "compilerOptions": {
    "baseUrl": ".", // root
    "paths": {
      "@app/*": ["src/app/*"],
    },
  },
}`;
    expect(JSON.parse(prepareJsonc(raw))).toEqual({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@app/*": ["src/app/*"] },
      },
    });
  });

  it("stripJsoncComments leaves strings intact", () => {
    expect(stripJsoncComments('"a//b"')).toBe('"a//b"');
  });
});
