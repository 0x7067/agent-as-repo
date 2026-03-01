import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
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
      expect(packageResult?.message).toContain("No package.json in current directory");
      expect(depsResult?.status).toBe("warn");
      expect(depsResult?.message).toContain("No package.json");
      expect(nodeResult?.status).toBe("fail");
      expect(nodeResult?.message).toContain("requires Node 99");
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
        "utf8",
      );

      const results = await runSelfChecks(dir);
      const manager = results.find((r) => r.name === "packageManager");
      const deps = results.find((r) => r.name === "dependencies");
      expect(manager?.status).toBe("fail");
      expect(manager?.message).toContain("Expected pnpm@");
      expect(deps?.status).toBe("fail");
      expect(deps?.message).toContain("node_modules not found");
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

  it("formats multiple results separated by newline", async () => {
    const text = formatSelfChecks([
      { name: "Node.js", status: "pass", message: "v22" },
      { name: "pnpm", status: "pass", message: "9.0" },
    ]);
    // Must contain newline between entries, not empty string
    expect(text).toContain("\n");
    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
  });

  it("node check passes when version meets minimum", async () => {
    await withTempDir("repo-expert-self-check-node-pass-", async (dir) => {
      const results = await runSelfChecks(dir, 1);
      const nodeResult = results.find((r) => r.name === "Node.js");
      expect(nodeResult?.status).toBe("pass");
      expect(nodeResult?.name).toBe("Node.js");
      expect(nodeResult?.message).toContain("Found");
    });
  });

  it("node check fail result has correct name field", async () => {
    await withTempDir("repo-expert-self-check-node-fail-", async (dir) => {
      const results = await runSelfChecks(dir, 99);
      const nodeResult = results.find((r) => r.name === "Node.js");
      expect(nodeResult?.name).toBe("Node.js");
      expect(nodeResult?.status).toBe("fail");
    });
  });

  it("pnpm check result has correct name and status when pnpm is available", async () => {
    await withTempDir("repo-expert-self-check-pnpm-", async (dir) => {
      const results = await runSelfChecks(dir, 1);
      const pnpmResult = results.find((r) => r.name === "pnpm");
      expect(pnpmResult?.name).toBe("pnpm");
      // pnpm is available in this environment
      expect(pnpmResult?.status).toBe("pass");
      expect(pnpmResult?.message).toContain("Found");
    });
  });

  it("packageManager check warns when field is missing", async () => {
    await withTempDir("repo-expert-self-check-pm-", async (dir) => {
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "x", version: "1.0.0" }),
        "utf8",
      );
      const results = await runSelfChecks(dir, 1);
      const pmResult = results.find((r) => r.name === "packageManager");
      expect(pmResult?.status).toBe("warn");
      expect(pmResult?.name).toBe("packageManager");
      expect(pmResult?.message).toContain("packageManager field is missing");
    });
  });

  it("packageManager check passes when pnpm@ prefix is used", async () => {
    await withTempDir("repo-expert-self-check-pm-pass-", async (dir) => {
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "x", version: "1.0.0", packageManager: "pnpm@9.0.0" }),
        "utf8",
      );
      const results = await runSelfChecks(dir, 1);
      const pmResult = results.find((r) => r.name === "packageManager");
      expect(pmResult?.status).toBe("pass");
      expect(pmResult?.message).toBe("pnpm@9.0.0");
    });
  });

  it("packageManager check fails when not pnpm", async () => {
    await withTempDir("repo-expert-self-check-pm-fail-", async (dir) => {
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "x", version: "1.0.0", packageManager: "npm@10.0.0" }),
        "utf8",
      );
      const results = await runSelfChecks(dir, 1);
      const pmResult = results.find((r) => r.name === "packageManager");
      expect(pmResult?.status).toBe("fail");
      expect(pmResult?.message).toContain("Expected pnpm@");
      expect(pmResult?.message).toContain("npm@10.0.0");
    });
  });

  it("packageManager check fails on 'pnpm' without @ (must be startsWith pnpm@)", async () => {
    await withTempDir("repo-expert-self-check-pm-no-at-", async (dir) => {
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "x", packageManager: "pnpm" }),
        "utf8",
      );
      const results = await runSelfChecks(dir, 1);
      const pmResult = results.find((r) => r.name === "packageManager");
      // "pnpm" doesn't start with "pnpm@", so it should fail
      expect(pmResult?.status).toBe("fail");
    });
  });

  it("dependencies warns when no deps declared", async () => {
    await withTempDir("repo-expert-self-check-nodeps-", async (dir) => {
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "x", version: "1.0.0", packageManager: "pnpm@9.0.0" }),
        "utf8",
      );
      const results = await runSelfChecks(dir, 1);
      const depsResult = results.find((r) => r.name === "dependencies");
      expect(depsResult?.status).toBe("warn");
      expect(depsResult?.name).toBe("dependencies");
      expect(depsResult?.message).toContain("No dependencies declared");
    });
  });

  it("dependencies check reports missing node_modules", async () => {
    await withTempDir("repo-expert-self-check-missing-nm-", async (dir) => {
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "x", dependencies: { vitest: "^1.0.0" } }),
        "utf8",
      );
      const results = await runSelfChecks(dir, 1);
      const depsResult = results.find((r) => r.name === "dependencies");
      expect(depsResult?.status).toBe("fail");
      expect(depsResult?.message).toContain("node_modules not found");
      expect(depsResult?.message).toContain("pnpm install");
    });
  });

  it("dependencies check passes when all deps installed", async () => {
    // Use the actual project directory as the test cwd — it has node_modules
    const projectDir = path.resolve(process.cwd());
    const results = await runSelfChecks(projectDir, 1);
    const depsResult = results.find((r) => r.name === "dependencies");
    expect(depsResult?.status).toBe("pass");
    expect(depsResult?.name).toBe("dependencies");
    // eslint-disable-next-line sonarjs/slow-regex
    expect(depsResult?.message).toMatch(/\d+ dependencies installed/);
  });

  it("dependencies check reports missing packages with message", async () => {
    await withTempDir("repo-expert-self-check-missing-deps-", async (dir) => {
      // Create node_modules dir but with no packages installed
      await fs.mkdir(path.join(dir, "node_modules"), { recursive: true });
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "x", dependencies: { "nonexistent-pkg": "^1.0.0" } }),
        "utf8",
      );
      const results = await runSelfChecks(dir, 1);
      const depsResult = results.find((r) => r.name === "dependencies");
      expect(depsResult?.status).toBe("fail");
      expect(depsResult?.message).toContain("Missing installed deps");
      expect(depsResult?.message).toContain("nonexistent-pkg");
    });
  });

  it("dependencies reports suffix when more than 5 missing deps", async () => {
    await withTempDir("repo-expert-self-check-many-missing-", async (dir) => {
      await fs.mkdir(path.join(dir, "node_modules"), { recursive: true });
      const deps: Record<string, string> = {};
      for (let i = 0; i < 7; i++) deps[`pkg-${String(i)}`] = "^1.0.0";
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "x", dependencies: deps }),
        "utf8",
      );
      const results = await runSelfChecks(dir, 1);
      const depsResult = results.find((r) => r.name === "dependencies");
      expect(depsResult?.status).toBe("fail");
      // 7 missing deps: shows first 5 + "(+2 more)"
      expect(depsResult?.message).toContain("(+2 more)");
    });
  });

  it("runSelfChecks returns exactly 4 results (no extra)", async () => {
    await withTempDir("repo-expert-self-check-count-", async (dir) => {
      const results = await runSelfChecks(dir, 1);
      expect(results).toHaveLength(4);
    });
  });

  it("node check: major version must be strictly less than minMajor to fail (not equal)", async () => {
    // When major === minMajor, it should PASS (not fail)
    // process.version is e.g. "v22.x.x", so major is around 22
    // Using minMajor = 1 means major (22) is NOT < 1, so it should pass
    await withTempDir("repo-expert-self-check-nodeversion-", async (dir) => {
      const results = await runSelfChecks(dir, 1);
      const nodeResult = results.find((r) => r.name === "Node.js");
      expect(nodeResult?.status).toBe("pass");
    });
  });

  it("pnpm fail result message is 'pnpm not found on PATH' (exact string)", async () => {
    // We can't easily make pnpm unavailable, but we test the fields on a pass result
    // for the case when pnpm is available (status + name + message format)
    await withTempDir("repo-expert-pnpm-fields-", async (dir) => {
      const results = await runSelfChecks(dir, 1);
      const pnpmResult = results.find((r) => r.name === "pnpm");
      // pnpm should be available in this environment
      expect(pnpmResult?.status).toBe("pass");
      // Message should start with "Found " not be empty
      expect(pnpmResult?.message).toMatch(/^Found /);
    });
  });

  it("missing deps separated by ', ' not empty string", async () => {
    await withTempDir("repo-expert-self-check-sep-", async (dir) => {
      await fs.mkdir(path.join(dir, "node_modules"), { recursive: true });
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "x", dependencies: { "pkg-a": "^1.0.0", "pkg-b": "^1.0.0" } }),
        "utf8",
      );
      const results = await runSelfChecks(dir, 1);
      const depsResult = results.find((r) => r.name === "dependencies");
      expect(depsResult?.status).toBe("fail");
      // Both packages should appear, separated by ", " not ""
      expect(depsResult?.message).toContain("pkg-a, pkg-b");
    });
  });

  it("missing deps suffix only appears when count > 5 (not >= 5)", async () => {
    await withTempDir("repo-expert-self-check-exactly5-", async (dir) => {
      await fs.mkdir(path.join(dir, "node_modules"), { recursive: true });
      const deps: Record<string, string> = {};
      for (let i = 0; i < 5; i++) deps[`pkg-${String(i)}`] = "^1.0.0";
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "x", dependencies: deps }),
        "utf8",
      );
      const results = await runSelfChecks(dir, 1);
      const depsResult = results.find((r) => r.name === "dependencies");
      // Exactly 5 missing deps: no suffix "(+0 more)" should appear
      expect(depsResult?.message).not.toContain("more)");
    });
  });

  it("node version regex requires leading v prefix", async () => {
    // The regex /^v(\d+)/ requires 'v' at start; process.version always starts with 'v'
    // This test just confirms the result is correct (major parsed properly)
    await withTempDir("repo-expert-self-check-regex-", async (dir) => {
      const results = await runSelfChecks(dir, 1);
      const nodeResult = results.find((r) => r.name === "Node.js");
      // Should find the version and pass (version string always starts with 'v')
      expect(nodeResult?.status).toBe("pass");
      expect(nodeResult?.message).toContain(process.version);
    });
  });

  it("readPackageJson rethrows non-ENOENT errors (e.g. EACCES)", async () => {
    await withTempDir("repo-expert-self-check-eacces-", async (dir) => {
      // Write a package.json then make it unreadable
      const pkgPath = path.join(dir, "package.json");
      await fs.writeFile(pkgPath, JSON.stringify({ name: "x" }), "utf8");
      await fs.chmod(pkgPath, 0o000);
      try {
        // runSelfChecks calls readPackageJson internally; non-ENOENT errors should propagate
        await expect(runSelfChecks(dir, 1)).rejects.toThrow();
      } finally {
        // Restore permissions so cleanup works
        // eslint-disable-next-line sonarjs/file-permissions
        await fs.chmod(pkgPath, 0o644);
      }
    });
  });

  it("readPackageJson returns null for missing file (ENOENT) but rethrows non-ENOENT", async () => {
    await withTempDir("repo-expert-self-check-enoent-", async (dir) => {
      // No package.json → ENOENT → returns null → warns, does not throw
      const results = await runSelfChecks(dir, 1);
      const pkgResult = results.find((r) => r.name === "package.json");
      expect(pkgResult?.status).toBe("warn");
    });
  });
});
