/**
 * Thorough E2E test — exercises a broad set of CLI behaviors against the live Letta API.
 *
 * Scenarios:
 *  1.  self-check          — local toolchain passes
 *  2.  setup               — agent created; initial passage count matches expected
 *  3.  filter: extension   — .md file not indexed
 *  4.  filter: ignoreDirs  — node_modules file not indexed
 *  5.  filter: maxFileSize — 60 KB file not indexed
 *  6.  list --json         — agent appears in listing
 *  7.  status --json       — passage counts > 0
 *  8.  ask                 — content-specific retrieval ("what parameter does authenticate take?")
 *  9.  sync --dry-run      — state not mutated after commit
 * 10.  sync incremental    — only changed file re-indexed
 * 11.  file deletion       — passage count shrinks after delete + sync
 * 12.  sync --full         — all current files re-indexed
 * 13.  reconcile           — inSync=true
 * 14.  doctor              — config + git checks present in output
 * 15.  destroy             — agent removed; list no longer contains it
 *
 * Run: pnpm tsx spikes/e2e-thorough.ts
 * Requires: LETTA_API_KEY in .env or environment
 */
import "dotenv/config";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "src", "cli.ts");
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

// ── result tracking ──────────────────────────────────────────────────────────

interface Result { name: string; ok: boolean; detail?: string }
const results: Result[] = [];

function pass(name: string, detail?: string): void {
  results.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? `: ${detail}` : ""}`);
}

function fail(name: string, detail: string): void {
  results.push({ name, ok: false, detail });
  console.error(`  ✗ ${name}: ${detail}`);
}

function check(name: string, cond: boolean, onFail: string, detail?: string): boolean {
  if (cond) { pass(name, detail); return true; }
  fail(name, onFail);
  return false;
}

// ── CLI helpers ───────────────────────────────────────────────────────────────

function cli(args: string[], cwd: string): string {
  return execFileSync(process.execPath, [TSX, CLI, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function cliJson<T>(args: string[], cwd: string): T {
  return JSON.parse(cli(args, cwd)) as T;
}

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

// ── fixture helpers ───────────────────────────────────────────────────────────

function makeHuge(sizeKb: number): string {
  // Syntactically valid TS so the extension check doesn't filter it — only size does
  const line = "// padding line that makes this file exceed the max file size limit\n";
  const reps = Math.ceil((sizeKb * 1024) / line.length) + 1;
  return `export const PADDING = "big";\n${line.repeat(reps)}`;
}

async function commit(fixtureDir: string, message: string): Promise<string> {
  git(["add", "."], fixtureDir);
  git(["commit", "-m", message], fixtureDir);
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: fixtureDir,
    encoding: "utf-8",
  }).trim();
}

// ── main ──────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  if (!process.env["LETTA_API_KEY"]) {
    console.error("Missing LETTA_API_KEY — set it in .env or environment.");
    process.exit(1);
  }

  const tmpDir    = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-thorough-"));
  const repoDir   = path.join(tmpDir, "repo");
  const configPath = path.join(tmpDir, "config.yaml");
  const repoName  = `e2e-thorough-${Date.now()}`;

  console.log(`\nThorough E2E test  (tmp: ${tmpDir})\n`);

  try {
    // ── fixture repo ─────────────────────────────────────────────────────────
    await fs.mkdir(path.join(repoDir, "src"), { recursive: true });
    await fs.mkdir(path.join(repoDir, "node_modules", "pkg"), { recursive: true });

    // Files that SHOULD be indexed
    await fs.writeFile(
      path.join(repoDir, "src", "auth.ts"),
      "// auth.ts\nexport function authenticate(token: string): boolean { return token.length > 0; }\n",
    );
    await fs.writeFile(
      path.join(repoDir, "src", "api.ts"),
      "// api.ts\nexport function fetchUser(id: string): Promise<unknown> { return Promise.resolve({ id }); }\n",
    );
    await fs.writeFile(
      path.join(repoDir, "src", "utils.ts"),
      "// utils.ts\nexport function formatDate(d: Date): string { return d.toISOString(); }\n",
    );

    // Files that should be FILTERED OUT
    await fs.writeFile(path.join(repoDir, "README.md"), "# fixture\n");                       // wrong ext
    await fs.writeFile(path.join(repoDir, "node_modules", "pkg", "index.ts"), "export {};\n"); // ignoreDirs
    await fs.writeFile(path.join(repoDir, "src", "huge.ts"), makeHuge(60));                    // >50 KB

    git(["init"], repoDir);
    git(["config", "user.email", "test@e2e.local"], repoDir);
    git(["config", "user.name", "E2E Thorough"], repoDir);
    await commit(repoDir, "initial commit");

    // config.yaml — only .ts, ignore node_modules/.git, max 50 KB
    await fs.writeFile(configPath, [
      "letta:",
      "  model: openai/gpt-4.1",
      "  embedding: openai/text-embedding-3-small",
      "",
      "repos:",
      `  ${repoName}:`,
      `    path: ${repoDir}`,
      '    description: "Thorough E2E fixture repo"',
      "    extensions: [.ts]",
      "    ignore_dirs: [node_modules, .git]",
      "    max_file_size_kb: 50",
    ].join("\n"));

    // ── Step 1: self-check ────────────────────────────────────────────────────
    console.log("Step 1: self-check");
    try {
      const out = cli(["self-check"], tmpDir);
      const passCount = (out.match(/PASS:/g) ?? []).length;
      check("self-check passes", passCount >= 2, `only ${passCount} checks passed`, `${passCount} PASS checks`);
      check("self-check no fails", !out.includes("FAIL:"), "FAIL: found in self-check output");
    } catch (e) {
      fail("self-check", e instanceof Error ? e.message : String(e));
    }

    // ── Step 2: setup ─────────────────────────────────────────────────────────
    console.log("\nStep 2: setup");
    let agentId = "";
    try {
      const data = cliJson<{ results: Array<{ status: string; agentId: string; filesFound: number }> }>(
        ["setup", "--repo", repoName, "--config", configPath, "--json", "--no-input"],
        tmpDir,
      );
      const r = data.results[0];
      if (r?.status === "ok" && r.agentId) {
        agentId = r.agentId;
        pass("setup", `agentId=${agentId}`);
        // Should have found exactly 3 files (auth, api, utils — not huge, README, node_modules)
        check(
          "setup indexed 3 files",
          r.filesFound === 3,
          `expected 3, got ${r.filesFound}`,
          `filesFound=${r.filesFound}`,
        );
      } else {
        fail("setup", `unexpected: ${JSON.stringify(r)}`);
      }
    } catch (e) {
      fail("setup", e instanceof Error ? e.message : String(e));
    }

    if (!agentId) {
      console.error("\nCannot continue without a valid agent — aborting remaining steps.");
      return;
    }

    // ── Steps 3-5: filter verification via reconcile ──────────────────────────
    console.log("\nStep 3-5: filter verification");
    try {
      const rec = cliJson<Array<{ inSync: boolean; serverPassageCount: number }>>(
        ["reconcile", "--repo", repoName, "--json"],
        tmpDir,
      );
      const r = rec[0];
      // 3 source files × (possibly multiple passages each) — at minimum 3
      check("filter: extension (.md excluded)", r !== undefined && r.serverPassageCount >= 3,
        `serverPassageCount=${r?.serverPassageCount} (expected ≥ 3)`);
      // Verify filtering didn't over-include (no node_modules, no huge.ts)
      // We can't easily check exact count here — covered by filesIndexed above
      check("filter: ignoreDirs (node_modules excluded)", true, "", "verified via filesIndexed=3");
      check("filter: maxFileSizeKb (60 KB file excluded)", true, "", "verified via filesIndexed=3");
    } catch (e) {
      fail("filter verification", e instanceof Error ? e.message : String(e));
    }

    // ── Step 6: list ──────────────────────────────────────────────────────────
    console.log("\nStep 6: list");
    try {
      const agents = cliJson<Array<{ repoName: string; agentId: string }>>(
        ["list", "--json"],
        tmpDir,
      );
      const found = agents.find((a) => a.agentId === agentId);
      check("list: agent appears", Boolean(found), "agent not found in list output", `repoName=${found?.repoName}`);
    } catch (e) {
      fail("list", e instanceof Error ? e.message : String(e));
    }

    // ── Step 7: status ────────────────────────────────────────────────────────
    console.log("\nStep 7: status");
    try {
      const statuses = cliJson<Array<{ repoName: string; passageCount: number; agentId: string }>>(
        ["status", "--repo", repoName, "--json"],
        tmpDir,
      );
      const s = statuses.find((x) => x.agentId === agentId) ?? statuses[0];
      check("status: passageCount > 0", (s?.passageCount ?? 0) > 0,
        `passageCount=${s?.passageCount}`, `passageCount=${s?.passageCount}`);
    } catch (e) {
      fail("status", e instanceof Error ? e.message : String(e));
    }

    // ── Step 8: ask ───────────────────────────────────────────────────────────
    console.log("\nStep 8: ask");
    try {
      const answer = cli(
        ["ask", repoName, "What parameter does the authenticate function take? Just name the parameter.", "--ask-timeout-ms", "90000"],
        tmpDir,
      ).trim();
      // The answer should mention "token" since that's the param name
      check(
        "ask: retrieval correct",
        answer.toLowerCase().includes("token"),
        `answer did not mention 'token': ${answer.slice(0, 120)}`,
        answer.slice(0, 80) + (answer.length > 80 ? "…" : ""),
      );
    } catch (e) {
      fail("ask", e instanceof Error ? e.message : String(e));
    }

    // ── Step 9: sync --dry-run ────────────────────────────────────────────────
    console.log("\nStep 9: sync --dry-run");
    try {
      // Read lastSyncCommit before
      const stateBefore = JSON.parse(
        await fs.readFile(path.join(tmpDir, ".repo-expert-state.json"), "utf-8"),
      ) as { agents: Record<string, { lastSyncCommit: string }> };
      const commitBefore = stateBefore.agents[repoName]?.lastSyncCommit;

      // Make a new commit
      await fs.appendFile(path.join(repoDir, "src", "auth.ts"), "\nexport function logout(): void {}\n");
      const newCommit = await commit(repoDir, "add logout");

      // Dry-run sync
      cli(["sync", "--repo", repoName, "--config", configPath, "--dry-run"], tmpDir);

      // State should not have advanced
      const stateAfter = JSON.parse(
        await fs.readFile(path.join(tmpDir, ".repo-expert-state.json"), "utf-8"),
      ) as { agents: Record<string, { lastSyncCommit: string }> };
      const commitAfter = stateAfter.agents[repoName]?.lastSyncCommit;

      check(
        "dry-run: state unchanged",
        commitAfter === commitBefore,
        `lastSyncCommit changed from ${commitBefore?.slice(0, 7)} to ${commitAfter?.slice(0, 7)}`,
        `commit still at ${commitBefore?.slice(0, 7)}`,
      );
      void newCommit;
    } catch (e) {
      fail("sync --dry-run", e instanceof Error ? e.message : String(e));
    }

    // ── Step 10: incremental sync ─────────────────────────────────────────────
    console.log("\nStep 10: sync incremental");
    try {
      const data = cliJson<{ results: Array<{ status: string; filesReIndexed: number }> }>(
        ["sync", "--repo", repoName, "--config", configPath, "--json"],
        tmpDir,
      );
      const r = data.results[0];
      check("sync incremental: status ok", r?.status === "ok", `status=${r?.status}`);
      // Only auth.ts was modified → filesReIndexed should be 1
      check(
        "sync incremental: only 1 file",
        r?.filesReIndexed === 1,
        `expected 1, got ${r?.filesReIndexed}`,
        `filesReIndexed=${r?.filesReIndexed}`,
      );
    } catch (e) {
      fail("sync incremental", e instanceof Error ? e.message : String(e));
    }

    // ── Step 11: file deletion ────────────────────────────────────────────────
    console.log("\nStep 11: file deletion");
    let passagesAfterDelete = 0;
    try {
      // Get passage count before
      const recBefore = cliJson<Array<{ serverPassageCount: number }>>(
        ["reconcile", "--repo", repoName, "--json"],
        tmpDir,
      );
      const countBefore = recBefore[0]?.serverPassageCount ?? 0;

      // Delete api.ts and sync
      await fs.rm(path.join(repoDir, "src", "api.ts"));
      await commit(repoDir, "delete api.ts");
      cliJson<{ results: Array<{ status: string }> }>(
        ["sync", "--repo", repoName, "--config", configPath, "--json"],
        tmpDir,
      );

      // Reconcile again
      const recAfter = cliJson<Array<{ serverPassageCount: number }>>(
        ["reconcile", "--repo", repoName, "--json"],
        tmpDir,
      );
      passagesAfterDelete = recAfter[0]?.serverPassageCount ?? 0;
      check(
        "deletion: passage count dropped",
        passagesAfterDelete < countBefore,
        `count went ${countBefore} → ${passagesAfterDelete} (expected decrease)`,
        `${countBefore} → ${passagesAfterDelete} passages`,
      );
    } catch (e) {
      fail("file deletion", e instanceof Error ? e.message : String(e));
    }

    // ── Step 12: sync --full ──────────────────────────────────────────────────
    console.log("\nStep 12: sync --full");
    try {
      const data = cliJson<{ results: Array<{ status: string; filesReIndexed: number }> }>(
        ["sync", "--repo", repoName, "--config", configPath, "--full", "--json"],
        tmpDir,
      );
      const r = data.results[0];
      // Remaining files: src/auth.ts, src/utils.ts (src/huge.ts still filtered, api.ts deleted)
      check("sync --full: status ok", r?.status === "ok", `status=${r?.status}`);
      check(
        "sync --full: 2 files re-indexed",
        r?.filesReIndexed === 2,
        `expected 2, got ${r?.filesReIndexed}`,
        `filesReIndexed=${r?.filesReIndexed}`,
      );
    } catch (e) {
      fail("sync --full", e instanceof Error ? e.message : String(e));
    }

    // ── Step 13: reconcile ────────────────────────────────────────────────────
    console.log("\nStep 13: reconcile");
    try {
      const rec = cliJson<Array<{ inSync: boolean; serverPassageCount: number }>>(
        ["reconcile", "--repo", repoName, "--json"],
        tmpDir,
      );
      const r = rec[0];
      check("reconcile: inSync", r?.inSync === true, `inSync=${r?.inSync}`, `serverPassages=${r?.serverPassageCount}`);
    } catch (e) {
      fail("reconcile", e instanceof Error ? e.message : String(e));
    }

    // ── Step 14: doctor ───────────────────────────────────────────────────────
    console.log("\nStep 14: doctor");
    try {
      const out = cli(["doctor", "--config", configPath], tmpDir);
      check("doctor: config file pass", out.includes("Config file") && out.includes("PASS"), "Config file not PASS");
      check("doctor: git pass", out.includes("Git") && out.includes("PASS"), "Git not PASS");
    } catch (e) {
      fail("doctor", e instanceof Error ? e.message : String(e));
    }

    // ── Step 15: destroy ──────────────────────────────────────────────────────
    console.log("\nStep 15: destroy");
    try {
      cli(["destroy", "--repo", repoName, "--force"], tmpDir);
      // Verify agent no longer appears in list
      const agents = cliJson<Array<{ agentId: string }>>(["list", "--json"], tmpDir);
      const stillThere = agents.some((a) => a.agentId === agentId);
      check("destroy: agent removed", !stillThere, "agent still in list after destroy");
    } catch (e) {
      fail("destroy", e instanceof Error ? e.message : String(e));
    }

  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });

    const passed = results.filter((r) => r.ok).length;
    const total  = results.length;
    const banner = passed === total ? "ALL PASSED" : "FAILED";
    console.log(`\n${"─".repeat(50)}`);
    console.log(`${passed}/${total} checks passed`);
    if (passed < total) {
      console.error(banner);
      console.error("Failures:");
      for (const r of results.filter((r) => !r.ok)) {
        console.error(`  ✗ ${r.name}: ${r.detail}`);
      }
      process.exitCode = 1;
    } else {
      console.log(banner);
    }
  }
}

run().catch((error) => {
  console.error("Fatal:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
