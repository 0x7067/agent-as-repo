import { describe, it, expect } from "vitest";
import { buildRipgrepArgs } from "./ripgrep-args.js";

describe("buildRipgrepArgs", () => {
  it("builds a minimal argv with pattern and search root", () => {
    expect(buildRipgrepArgs({ pattern: "foo" })).toEqual([
      "--line-number",
      "--no-heading",
      "--color",
      "never",
      "--max-count",
      "50",
      "--",
      "foo",
      ".",
    ]);
  });

  it("adds -i when caseInsensitive is true", () => {
    const args = buildRipgrepArgs({ pattern: "Foo", caseInsensitive: true });
    expect(args[0]).toBe("-i");
    expect(args).toContain("Foo");
  });

  it("adds --glob when glob is provided", () => {
    const args = buildRipgrepArgs({ pattern: "bar", glob: "*.ts" });
    const globIdx = args.indexOf("--glob");
    expect(globIdx).toBeGreaterThan(-1);
    expect(args[globIdx + 1]).toBe("*.ts");
  });

  it("scopes search to a relative path when provided", () => {
    const args = buildRipgrepArgs({ pattern: "baz", path: "src" });
    expect(args.at(-1)).toBe("src");
  });

  it("respects custom maxResults", () => {
    const args = buildRipgrepArgs({ pattern: "x", maxResults: 10 });
    const idx = args.indexOf("--max-count");
    expect(args[idx + 1]).toBe("10");
  });

  it("adds --glob ignore patterns for each ignoreDir", () => {
    const args = buildRipgrepArgs({
      pattern: "x",
      ignoreDirs: ["node_modules", ".git"],
    });
    const globs: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--glob") globs.push(args[i + 1]!);
    }
    expect(globs).toContain("!node_modules/**");
    expect(globs).toContain("!.git/**");
  });

  it("rejects an empty pattern", () => {
    expect(() => buildRipgrepArgs({ pattern: "" })).toThrow(/pattern/i);
  });
});
