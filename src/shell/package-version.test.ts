import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { readPackageVersion, readPackageVersionFromRequire } from "./package-version.js";

describe("readPackageVersion", () => {
  it("returns the version string from the repo's package.json", () => {
    const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    expect(readPackageVersion()).toBe(pkg.version);
  });

  it("falls back to the dist/bin-relative package.json path for bundled output", () => {
    const requireFromHere = vi.fn((id: string): unknown => {
      if (id === "../package.json") throw new Error("missing dist/package.json");
      if (id === "../../package.json") return { version: "2.3.4" };
      throw new Error(`unexpected require path: ${id}`);
    });

    expect(readPackageVersionFromRequire(requireFromHere)).toBe("2.3.4");
    expect(requireFromHere).toHaveBeenCalledWith("../package.json");
    expect(requireFromHere).toHaveBeenCalledWith("../../package.json");
  });

  it("returns the fallback version when no package.json is resolvable (SEA)", () => {
    const requireFromHere = vi.fn((): unknown => {
      throw new Error("synthetic SEA path");
    });
    expect(readPackageVersionFromRequire(requireFromHere)).toBe("0.0.0");
  });
});
