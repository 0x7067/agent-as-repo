import { describe, expect, it } from "vitest";
import { expandPathAlias, parsePathAliasConfig } from "./tsconfig-paths.js";

describe("parsePathAliasConfig", () => {
  it("reads baseUrl and paths from compilerOptions", () => {
    const cfg = parsePathAliasConfig({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@app/*": ["src/app/*"],
          "@lib": ["src/lib/index.ts"],
        },
      },
    });
    expect(cfg).toEqual({
      baseUrl: ".",
      paths: [
        { pattern: "@app/*", targets: ["src/app/*"] },
        { pattern: "@lib", targets: ["src/lib/index.ts"] },
      ],
    });
  });

  it("returns undefined for non-objects", () => {
    expect(parsePathAliasConfig(null)).toBeUndefined();
    expect(parsePathAliasConfig("x")).toBeUndefined();
  });
});

describe("expandPathAlias", () => {
  const aliases = {
    baseUrl: ".",
    paths: [
      { pattern: "@app/*", targets: ["src/app/*"] },
      { pattern: "@lib", targets: ["src/lib/index"] },
    ],
  };

  it("expands wildcard aliases", () => {
    expect(expandPathAlias("@app/auth/login", aliases)).toEqual(["src/app/auth/login"]);
  });

  it("expands exact aliases", () => {
    expect(expandPathAlias("@lib", aliases)).toEqual(["src/lib/index"]);
  });

  it("returns [] when no pattern matches", () => {
    expect(expandPathAlias("lodash", aliases)).toEqual([]);
  });
});
