import { describe, it, expect } from "vitest";
import { resolveRepoTarget } from "./repo-target.js";

describe("resolveRepoTarget", () => {
  it("returns no repo when neither positional nor flag are given", () => {
    expect(resolveRepoTarget(undefined, undefined)).toEqual({});
  });

  it("uses the positional argument when only it is given", () => {
    expect(resolveRepoTarget("sinatra", undefined)).toEqual({ repo: "sinatra" });
  });

  it("uses the --repo flag when only it is given", () => {
    expect(resolveRepoTarget(undefined, "sinatra")).toEqual({ repo: "sinatra" });
  });

  it("accepts matching positional and flag values", () => {
    expect(resolveRepoTarget("sinatra", "sinatra")).toEqual({ repo: "sinatra" });
  });

  it("errors on conflicting positional and flag values, naming both", () => {
    const result = resolveRepoTarget("sinatra", "flask");
    expect(result.repo).toBeUndefined();
    expect(result.error).toContain("sinatra");
    expect(result.error).toContain("flask");
  });
});
