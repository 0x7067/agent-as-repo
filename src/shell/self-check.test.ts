import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { formatSelfChecks, runSelfChecks } from "./self-check.js";

async function withTempDir(prefix: string, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("self-check", () => {
  it("reports warnings when package.json is missing", async () => {
    await withTempDir("repo-expert-self-check-empty-", async (dir) => {
      const results = await runSelfChecks(dir, 99);
      const packageResult = results.find((r) => r.name === "package.json");
      const depsResult = results.find((r) => r.name === "dependencies");
      const nodeResult = results.find((r) => r.name === "Node.js");
      expect(packageResult?.status).toBe("warn");
      expect(depsResult?.status).toBe("warn");
      expect(nodeResult?.status).toBe("fail");
    });
  });

  it("fails on invalid package manager declaration and missing installs", async () => {
    await withTempDir("repo-expert-self-check-invalid-", async (dir) => {
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({
          name: "x",
          version: "1.0.0",
          packageManager: "npm@10.0.0",
          dependencies: { commander: "^14.0.0" },
        }),
        "utf-8",
      );

      const results = await runSelfChecks(dir);
      const manager = results.find((r) => r.name === "packageManager");
      const deps = results.find((r) => r.name === "dependencies");
      expect(manager?.status).toBe("fail");
      expect(deps?.status).toBe("fail");
    });
  });

  it("formats output with uppercase status prefixes", async () => {
    const text = formatSelfChecks([
      { name: "Node.js", status: "pass", message: "ok" },
      { name: "pnpm", status: "fail", message: "missing" },
    ]);
    expect(text).toContain("PASS: Node.js - ok");
    expect(text).toContain("FAIL: pnpm - missing");
  });
});
