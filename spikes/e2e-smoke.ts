/**
 * E2E smoke test — exercises the full core loop against the live Letta API.
 *
 * Run: pnpm tsx spikes/e2e-smoke.ts
 * Requires: LETTA_API_KEY set in .env or environment
 */
import "dotenv/config";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "src", "cli.ts");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

type Result = { name: string; ok: boolean; detail?: string };

const results: Result[] = [];

function pass(name: string, detail?: string): void {
  results.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? `: ${detail}` : ""}`);
}

function fail(name: string, detail: string): void {
  results.push({ name, ok: false, detail });
  console.error(`  ✗ ${name}: ${detail}`);
}

function cli(args: string[], cwd: string): string {
  return execFileSync(process.execPath, [TSX, CLI, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

async function run(): Promise<void> {
  if (!process.env["LETTA_API_KEY"]) {
    console.error("Missing LETTA_API_KEY — set it in .env or environment.");
    process.exit(1);
  }

  // Create temp dirs
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-smoke-"));
  const fixtureDir = path.join(tmpDir, "fixture-repo");
  const configPath = path.join(tmpDir, "config.yaml");
  const statePath = path.join(tmpDir, ".repo-expert-state.json");

  console.log(`\nE2E smoke test (tmp: ${tmpDir})\n`);

  try {
    // --- Setup fixture repo ---
    await fs.mkdir(fixtureDir, { recursive: true });
    execFileSync("git", ["init"], { cwd: fixtureDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@e2e.local"], { cwd: fixtureDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "E2E Test"], { cwd: fixtureDir, stdio: "pipe" });

    await fs.writeFile(path.join(fixtureDir, "auth.ts"), "// auth.ts\nexport function authenticate(token: string): boolean { return token.length > 0; }\n");
    await fs.writeFile(path.join(fixtureDir, "api.ts"), "// api.ts\nexport function fetchUser(id: string): Promise<unknown> { return Promise.resolve({ id }); }\n");
    await fs.writeFile(path.join(fixtureDir, "utils.ts"), "// utils.ts\nexport function formatDate(d: Date): string { return d.toISOString(); }\n");

    execFileSync("git", ["add", "."], { cwd: fixtureDir, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "initial commit"], { cwd: fixtureDir, stdio: "pipe" });

    // Write config.yaml
    const repoName = `e2e-smoke-${Date.now()}`;
    const config = `
letta:
  model: openai/gpt-4.1
  embedding: openai/text-embedding-3-small

repos:
  ${repoName}:
    path: ${fixtureDir}
    description: "E2E smoke test fixture repo"
    extensions: [.ts]
    ignore_dirs: [node_modules, .git]
`.trim();
    await fs.writeFile(configPath, config, "utf-8");

    // --- Step 1: setup ---
    console.log("Step 1: setup");
    try {
      const out = cli(
        ["setup", "--repo", repoName, "--config", configPath, "--json", "--no-input"],
        tmpDir,
      );
      const data = JSON.parse(out) as { results: Array<{ status: string; agentId: string }> };
      const result = data.results[0];
      if (result?.status === "ok" && result.agentId) {
        pass("setup", `agentId=${result.agentId}`);
      } else {
        fail("setup", `unexpected result: ${JSON.stringify(result)}`);
      }
    } catch (err) {
      fail("setup", err instanceof Error ? err.message : String(err));
    }

    // --- Step 2: ask ---
    console.log("\nStep 2: ask");
    try {
      // Copy state file to tmpDir location expected by CLI (relative to cwd)
      const defaultState = path.join(ROOT, ".repo-expert-state.json");
      // The CLI loads state from .repo-expert-state.json relative to cwd
      // We run CLI from tmpDir so state is written there by setup
      const answer = cli(
        ["ask", repoName, "What files exist in this repo?", "--ask-timeout-ms", "90000"],
        tmpDir,
      ).trim();
      if (answer.length > 0) {
        pass("ask", `${answer.slice(0, 60)}…`);
      } else {
        fail("ask", "empty response");
      }
    } catch (err) {
      fail("ask", err instanceof Error ? err.message : String(err));
    }

    // --- Step 3: sync (modify a file) ---
    console.log("\nStep 3: sync");
    try {
      await fs.appendFile(path.join(fixtureDir, "auth.ts"), "\nexport function logout(): void {}\n");
      execFileSync("git", ["add", "."], { cwd: fixtureDir, stdio: "pipe" });
      execFileSync("git", ["commit", "-m", "add logout"], { cwd: fixtureDir, stdio: "pipe" });

      const out = cli(
        ["sync", "--repo", repoName, "--config", configPath, "--json"],
        tmpDir,
      );
      const data = JSON.parse(out) as { results: Array<{ status: string; filesReIndexed?: number }> };
      const result = data.results[0];
      if (result?.status === "ok") {
        pass("sync", `filesReIndexed=${result.filesReIndexed ?? 0}`);
      } else {
        fail("sync", `unexpected result: ${JSON.stringify(result)}`);
      }
    } catch (err) {
      fail("sync", err instanceof Error ? err.message : String(err));
    }

    // --- Step 4: reconcile ---
    console.log("\nStep 4: reconcile");
    try {
      const out = cli(
        ["reconcile", "--repo", repoName, "--json"],
        tmpDir,
      );
      const data = JSON.parse(out) as Array<{ inSync: boolean; serverPassageCount: number }>;
      const result = data[0];
      if (result) {
        pass("reconcile", `inSync=${result.inSync} serverPassages=${result.serverPassageCount}`);
      } else {
        fail("reconcile", "no reconcile result returned");
      }
    } catch (err) {
      fail("reconcile", err instanceof Error ? err.message : String(err));
    }

    // --- Step 5: destroy ---
    console.log("\nStep 5: destroy");
    try {
      cli(["destroy", "--repo", repoName, "--force"], tmpDir);
      pass("destroy");
    } catch (err) {
      fail("destroy", err instanceof Error ? err.message : String(err));
    }
  } finally {
    // Always clean up temp dir
    await fs.rm(tmpDir, { recursive: true, force: true });

    const passed = results.filter((r) => r.ok).length;
    const total = results.length;
    console.log(`\n${"─".repeat(40)}`);
    console.log(`${passed}/${total} steps passed`);
    if (passed < total) {
      console.error("FAILED");
      process.exitCode = 1;
    } else {
      console.log("ALL PASSED");
    }
  }
}

run().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
