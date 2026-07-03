# Production Readiness Plan

**Date:** 2026-07-03
**Status:** Proposed
**Source:** Production-adoption audit (setup, maintainability, value, security) conducted 2026-07-03

> **For implementers (Claude/Codex/other agents):** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task, if available. If not available, follow the "How to use this plan" section below exactly.

## Goal

Close every concern raised by the 2026-07-03 production-readiness audit, without requiring architectural judgment calls from the implementing model. Each task below is a **complete vertical slice**: one concern, fully resolved end-to-end (code + tests + docs + verification), independently committable, independently revertable.

## How to use this plan

1. **Work one task at a time, in order within a wave.** Tasks inside the same wave with no arrows between them are independent and may be done in any order (or in parallel by different agents), but tasks across waves have real dependencies — do not skip ahead.
2. **Every task follows TDD red→green→commit**, per `CLAUDE.md`. Do not write production code before the failing test exists, except for the pure documentation/config tasks explicitly marked "No test needed."
3. **Do not batch tasks into one commit.** One task = one commit (or, where a task explicitly lists multiple commits, one commit per listed step). This matches the repo's existing convention of small, single-purpose commits.
4. **Run the verification commands exactly as written** at the end of each task before moving on. If a command fails, fix it before proceeding — do not continue to the next task with a red build.
5. **If a task says "STOP and report"**, it means the outcome depends on information the plan cannot predict (e.g., a spike's findings, a live vulnerability advisory). Do not guess — produce the requested findings artifact and pause for review before continuing to the dependent task.
6. Every command below assumes you are in the repository root (`/workspace`) with `pnpm install` already run.

---

## Wave overview

| Wave | Theme | Risk | Tasks |
|---|---|---|---|
| 0 | Guardrails (legal + CI trust) | Low | 1–4 |
| 1 | Dependency security hygiene | Low–Medium | 5–8 |
| 2 | Test-gate integrity | Low | 9 |
| 3 | Config correctness (quick bugfix) | Low | 10 |
| 4 | SDK currency | Medium–High | 11–12 |
| 5 | Retrieval quality (tree-sitter chunking) | High | 13–16 |
| 6 | Documentation refresh | Low | 17 |

Waves 0–3 are mechanical and low-risk — safe for any model to execute unattended. Waves 4–5 are inherently exploratory (they depend on live SDK/library behavior the plan cannot pin down in advance) and follow the project's own established **spike-first methodology** (see `phase-0-findings.md` and `spikes/` for the reference pattern this repo already uses). Do not skip the spike steps in Waves 4–5 even if the implementation seems obvious — this codebase has a documented history (`.claude/napkin.md`) of assumptions about the Letta SDK turning out to be wrong.

---

## Wave 0 — Guardrails

### Task 1: Add a LICENSE file

**Why:** `package.json` declares `"license": "ISC"` and `.changeset/config.json` has `"access": "public"` (intent to publish to npm), but no `LICENSE` file exists. This is a blocking legal gap for any organization adopting the project.

**Files:**
- Create: `LICENSE`

**No test needed** (this is a static legal document, not code).

**Step 1: Create the LICENSE file matching the declared `package.json` license**

Create `/workspace/LICENSE` with the standard ISC license text:

```
ISC License

Copyright (c) 2026, Pedro Guimarães

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

**Step 2: Verify**

```bash
test -f LICENSE && echo "LICENSE exists"
grep -q "ISC License" LICENSE && echo "matches package.json license field"
```

**Step 3: Commit**

```bash
git add LICENSE
git commit -m "chore: add ISC LICENSE file matching package.json declaration"
```

> If the repository owner wants a different license (e.g. MIT or Apache-2.0), update **both** `LICENSE` and the `"license"` field in `package.json` together in the same commit — never let them disagree.

---

### Task 2: Add an `engines` field to `package.json`

**Why:** CI pins Node 20 and `packageManager` pins `pnpm@10.20.0`, but nothing enforces this for local installs. There is no guard against a contributor running an incompatible Node version.

**Files:**
- Modify: `package.json`

**No test needed** (metadata field; validated by the verification command below, and indirectly by `self-check`/`doctor` commands which already inspect `package.json`).

**Step 1: Add the field**

In `package.json`, add an `"engines"` key immediately after `"packageManager"`:

```json
  "packageManager": "pnpm@10.20.0",
  "engines": {
    "node": ">=20 <21"
  },
```

Use the exact Node major version the CI workflow pins (`node-version: 20` in `.github/workflows/ci.yml`). If that value ever changes, update this field in the same commit.

**Step 2: Verify**

```bash
node -e "const p = require('./package.json'); if (!p.engines || !p.engines.node) throw new Error('missing engines.node')"
pnpm install --frozen-lockfile
```

Both commands should succeed with no errors.

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add engines.node matching CI's pinned Node 20"
```

---

### Task 3: Fix the current ESLint failures (`unicorn/prefer-top-level-await`)

**Why:** `pnpm lint` currently fails on `main` with 4 errors in `scripts/build.ts`, `scripts/sea-cli-entry.ts`, `scripts/sea-mcp-entry.ts`, and `src/mcp-server.ts`. **Do not** "fix" these by converting to top-level `await`/`try`/`catch` — commit `7d0cfb4` (`refactor: replace top-level await try/catch with .catch() chains`) deliberately moved these exact files *away* from top-level await, and `.claude/napkin.md` documents why: `tsx` executes build scripts as CJS and top-level `await` breaks at runtime, and the SEA/CJS bundle target (`scripts/build.ts`'s `seaShared` config, `format: "cjs"`) cannot use top-level await at all. Reverting to top-level await would reintroduce a previously-fixed bug.

The correct fix is a **scoped ESLint rule override** for these specific entry-point files, following the exact pattern already used for `spikes/**/*.ts` in `eslint.config.mjs` (search for `"unicorn/prefer-top-level-await": "off"` — it already exists for two other blocks, just not for these four files).

**Files:**
- Modify: `eslint.config.mjs`
- Modify: `src/__tests__/lint-config.test.ts` (this repo already has a dedicated test file asserting properties of the ESLint config — check it first with `Read` before editing, and add a case there instead of duplicating logic if a similar assertion pattern already exists)

**Step 1: Confirm the current failure (red)**

```bash
pnpm lint
```

Expected: exactly 4 errors, all `unicorn/prefer-top-level-await`, in the four files named above.

**Step 2: Add the scoped override**

Open `eslint.config.mjs`. Find the existing block that targets `files: ["spikes/**/*.ts"]` and disables `"unicorn/prefer-top-level-await"`. Immediately after that block (or after the `spikes/provider-parity-stress.ts` block — check both for the nearest logical place), add a new block:

```js
	// ============================================================
	// 🚪 ENTRY POINTS: CJS/tsx-compatible error handling
	// ============================================================
	// These files intentionally use `.catch()` chains instead of top-level
	// await. Reasons (see .claude/napkin.md, commit 7d0cfb4):
	//   1. `tsx` executes build scripts as CJS; top-level await breaks at runtime.
	//   2. The SEA bundle target (scripts/build.ts `seaShared`, format: "cjs")
	//      cannot use top-level await at all.
	// Do not "fix" these files by introducing top-level await.
	{
		files: [
			"scripts/build.ts",
			"scripts/sea-cli-entry.ts",
			"scripts/sea-mcp-entry.ts",
			"src/mcp-server.ts",
		],
		rules: {
			"unicorn/prefer-top-level-await": "off",
		},
	},
```

Place this block anywhere after the base rule configuration (order matters in flat ESLint config only in that later blocks win for overlapping `files` globs — since no earlier block already targets these exact four files with this rule, placement relative to unrelated blocks is safe).

**Step 3: Confirm green**

```bash
pnpm lint
```

Expected: `0 problems`, exit code 0.

**Step 4: Check for an existing lint-config test to extend**

```bash
cat src/__tests__/lint-config.test.ts
```

If this file already asserts something about rule overrides (e.g. "spikes disable X rule"), add one more `it()` block asserting that `scripts/build.ts`, `scripts/sea-cli-entry.ts`, `scripts/sea-mcp-entry.ts`, and `src/mcp-server.ts` have `unicorn/prefer-top-level-await` set to `"off"` in the resolved config, following the exact same assertion style already used in that file. If the file's existing tests don't cover per-file rule resolution at all, skip this step — do not invent a new testing pattern for a config-only change.

**Step 5: Run full verification**

```bash
pnpm lint
pnpm typecheck
pnpm test
```

All three must pass with no errors.

**Step 6: Commit**

```bash
git add eslint.config.mjs src/__tests__/lint-config.test.ts
git commit -m "fix: scope unicorn/prefer-top-level-await override to CJS/tsx entry points"
```

(Drop `src/__tests__/lint-config.test.ts` from the `git add` if you did not modify it in Step 4.)

---

### Task 4: Wire `lint` and `typecheck` into CI

**Why:** `.github/workflows/ci.yml` currently only runs `doctor --fix` and `pnpm test`. It never runs `pnpm lint` or `pnpm typecheck`, which is precisely how Task 3's lint failures went unnoticed on `main` for months. **This task must run after Task 3 is merged**, otherwise CI will immediately go red on the pre-existing lint errors.

**Files:**
- Modify: `.github/workflows/ci.yml`

**No test needed** (CI workflow YAML; verified by triggering CI itself).

**Step 1: Add lint and typecheck steps**

Open `.github/workflows/ci.yml`. Insert two new steps between "Install dependencies" and "Prepare CI config fixture":

```yaml
      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck
```

The full `steps:` list should read, in order: Checkout → Setup pnpm → Setup Node.js → Install dependencies → **Lint** → **Typecheck** → Prepare CI config fixture → Run doctor gate with safe fixes → Run tests.

**Step 2: Verify locally**

Simulate the CI steps in the exact order they'll run:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
```

All four commands must succeed.

**Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run lint and typecheck before tests"
```

**Step 4: Push and confirm the CI run is green**

After pushing this branch, check the Actions run for this commit (`gh run list --branch <branch> --limit 1` then `gh run view <run-id>`) and confirm all steps pass. If lint or typecheck fail in CI but passed locally, do not proceed to later tasks until you've diagnosed the discrepancy (likely a Node version difference — see Task 2).

---

## Wave 1 — Dependency security hygiene

> Run `pnpm audit --prod` before and after each task in this wave to confirm the targeted advisory disappears and no new one appears.

### Task 5: Patch the `js-yaml` DoS advisory

**Why:** `js-yaml@4.1.1` (currently pinned range `^4.1.1`) has a quadratic-complexity denial-of-service vulnerability in merge-key/alias handling (GHSA-h67p-54hq-rp68), patched in `4.2.0`. `js-yaml` is used directly to parse user-supplied `config.yaml` — an attacker-crafted config file is a plausible trigger path.

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml` (auto-generated — do not hand-edit)

**Step 1: Confirm the current vulnerability (red)**

```bash
pnpm audit --prod 2>&1 | grep -A 8 "js-yaml"
```

Expected: shows the GHSA-h67p-54hq-rp68 advisory for `js-yaml <=4.1.1`.

**Step 2: Bump the dependency**

```bash
pnpm add js-yaml@^4.2.0
```

**Step 3: Confirm green**

```bash
pnpm audit --prod 2>&1 | grep "js-yaml" || echo "no js-yaml advisories remain"
pnpm test
pnpm typecheck
```

`src/shell/config-loader.ts` and its test should still pass unchanged — this is a patch-level bump with no API changes.

**Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "fix(deps): bump js-yaml to 4.2.0, patches quadratic DoS advisory"
```

---

### Task 6: Patch the `hono` transitive advisories (via `@modelcontextprotocol/sdk`)

**Why:** `@modelcontextprotocol/sdk@^1.26.0` pulls in a vulnerable `hono` (<4.12.25), with 8 advisories ranging low→moderate (JWT `NumericDate` validation, JSX HTML injection in SSR, dropped repeated headers in Lambda@Edge adapters, timing-safe comparison hardening). None of these are exploitable through this project's actual stdio-transport MCP server usage today, but the dependency should still be current before this server is ever exposed over HTTP/SSE transports.

**Files:**
- Modify: `package.json`

**Step 1: Confirm current advisories (red)**

```bash
pnpm audit --prod 2>&1 | grep -B 2 -A 8 "hono"
```

**Step 2: Check for a newer `@modelcontextprotocol/sdk` that bundles a patched `hono`**

```bash
npm view @modelcontextprotocol/sdk versions --json | tail -20
npm view @modelcontextprotocol/sdk@latest version
```

**Step 3a — if a newer `@modelcontextprotocol/sdk` resolves the `hono` advisory:**

```bash
pnpm add @modelcontextprotocol/sdk@latest
pnpm audit --prod 2>&1 | grep "hono" || echo "no hono advisories remain"
```

Then run the full MCP server test suite and a manual handshake check (this project has no network access restriction on stdio, so this is safe to run locally):

```bash
pnpm test src/mcp-server.test.ts
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | LETTA_API_KEY=test-key npx tsx src/mcp-server.ts | head -5
```

Confirm the handshake still returns `serverInfo: { name: "letta-tools" }`.

**Step 3b — if no newer SDK version resolves it (the SDK's own `hono` pin hasn't moved):**

Add a `pnpm.overrides` entry to `package.json` to force a patched `hono` version without waiting on upstream:

```json
  "pnpm": {
    "overrides": {
      "hono": "^4.12.25"
    }
  }
```

Then:

```bash
pnpm install
pnpm audit --prod 2>&1 | grep "hono" || echo "no hono advisories remain"
pnpm test src/mcp-server.test.ts
```

**Step 4: STOP and report if the override breaks the MCP server tests.** `hono` version jumps have historically changed internal APIs; `@modelcontextprotocol/sdk` may depend on `hono` internals not covered by its own semver. If `pnpm test src/mcp-server.test.ts` fails after the override, revert the override, leave the advisories open, and write a one-paragraph findings note at the top of this task in this file (do not silently skip it).

**Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "fix(deps): patch hono transitive advisories via @modelcontextprotocol/sdk"
```

---

### Task 7: Patch the critical `vitest` UI advisory

**Why:** `vitest@>=4.0.0 <4.1.0` (dev dependency) has a critical advisory: when the Vitest UI server is listening, arbitrary files can be read and executed. This project does not run the Vitest UI in CI, but any contributor running `vitest --ui` locally is exposed.

**Files:**
- Modify: `package.json`

**Step 1: Confirm (red)**

```bash
pnpm audit 2>&1 | grep -B 3 -A 8 "critical"
```

**Step 2: Bump vitest and its ecosystem packages together**

```bash
pnpm add -D vitest@^4.1.0 @vitest/eslint-plugin@latest
```

**Step 3: Confirm green and run the full suite (vitest major/minor bumps can change reporter output or matcher behavior)**

```bash
pnpm audit 2>&1 | grep "critical" || echo "no critical advisories remain"
pnpm test
pnpm run test:mutation -- --dryRunOnly 2>&1 | tail -20 || true
```

The mutation dry-run is a smoke check only (Stryker uses its own vitest config files — `vitest.stryker.config.ts`, `vitest.stryker.shell.config.ts` — confirm these still resolve correctly against the new vitest version). If `pnpm test` fails after the bump, read the failure carefully before assuming it's a real regression — vitest major bumps sometimes change snapshot/serialization formatting, which can look like a failure but is just an assertion string mismatch.

**Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "fix(deps): bump vitest to 4.1.x, patches critical UI-server advisory"
```

---

### Task 8: Add a non-blocking `pnpm audit` report to CI

**Why:** Without any audit step in CI, dependency advisories accumulate silently (as they did here — 37 production advisories went unnoticed). A blocking gate is too strict for a solo/small-team project (transitive advisories outside your control would permanently red the pipeline), so start with a **visible, non-blocking** report.

**Files:**
- Modify: `.github/workflows/ci.yml`

**No test needed.**

**Step 1: Add the step**

In `.github/workflows/ci.yml`, add a new step after "Run tests" (the last step):

```yaml
      - name: Dependency audit (report only)
        if: always()
        run: pnpm audit --prod || true
```

The `if: always()` ensures this runs even if a prior step failed, so the audit report is always visible in the job log. The `|| true` prevents a non-zero `pnpm audit` exit code from failing the job — this step is informational only.

**Step 2: Verify**

```bash
pnpm audit --prod || true
echo "exit code was suppressed: $?"
```

The second command should print `0` even if audit found advisories.

**Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: report production dependency advisories on every run (non-blocking)"
```

> Revisit this in 3–6 months: once Tasks 5–7 are merged and the advisory count is near zero, consider making this step blocking on `high`/`critical` only (`pnpm audit --prod --audit-level=high`).

---

## Wave 2 — Test-gate integrity

### Task 9: Raise the MCP server's Stryker mutation threshold from 0 to 70

**Why:** `stryker.mcp.config.mjs` currently sets `thresholds: { high: 97, low: 90, break: 0 }` — mutation score is measured but never enforced. `src/mcp-server.ts` is the most externally-exposed surface in the codebase (it processes tool calls from other AI agents over stdio), yet it's the only module with zero enforcement. `src/shell/**` already enforces `break: 70`; align the MCP server to the same floor.

**Files:**
- Modify: `stryker.mcp.config.mjs`
- Possibly modify: `src/mcp-server.test.ts` (only if the mutation run surfaces gaps — see Step 2)

**Step 1: Run the current mutation suite to get a baseline score**

```bash
pnpm exec stryker run stryker.mcp.config.mjs 2>&1 | tail -40
```

This can take several minutes. Note the reported mutation score percentage and the list of surviving mutants (Stryker prints file:line and the mutation description for each survivor).

**Step 2: Decide based on the baseline score**

- **If the baseline score is already ≥ 70%:** skip straight to Step 3 (raise the threshold; no new tests needed).
- **If the baseline score is below 70%:** for each surviving mutant Stryker reports, add or strengthen a test case in `src/mcp-server.test.ts` that would fail if that mutation were applied (e.g., a mutant that changes `>` to `>=` needs a boundary-value test; a mutant that removes a null check needs a test with that null input). Do this one surviving mutant at a time — after each new/updated test, re-run `pnpm test src/mcp-server.test.ts` to confirm it passes against the real code, then re-run the mutation command from Step 1 to confirm the mutant is now killed. Repeat until the score is ≥ 70%.

**Step 3: Raise the threshold**

Edit `stryker.mcp.config.mjs`:

```js
export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.stryker.shell.config.ts" },
  mutate: ["src/mcp-server.ts"],
  coverageAnalysis: "perTest",
  thresholds: { high: 97, low: 90, break: 70 },
  reporters: ["clear-text", "progress"],
};
```

(Only the `break` value changes, from `0` to `70`.)

**Step 4: Confirm green**

```bash
pnpm exec stryker run stryker.mcp.config.mjs
```

Must exit 0 (Stryker exits non-zero if the score is below `break`).

**Step 5: Commit**

If Step 2 required new tests, commit those first, separately from the threshold change:

```bash
git add src/mcp-server.test.ts
git commit -m "test(mcp-server): kill surviving mutants ahead of raising break threshold"
```

Then commit the threshold change:

```bash
git add stryker.mcp.config.mjs
git commit -m "chore(stryker): raise MCP server mutation break threshold from 0 to 70"
```

---

## Wave 3 — Config correctness

### Task 10: Make the dangling `chunking: "tree-sitter"` config option fail fast

**Why:** `src/core/config.ts`'s `defaultsSchema` accepts `chunking: z.enum(["raw", "tree-sitter"])`, and `Config.defaults.chunking` is stored — but nothing in `src/shell/sync.ts` or `src/cli.ts` ever reads `config.defaults.chunking` to select a strategy. Both call sites hardcode `rawTextStrategy`. Today, a user who sets `chunking: tree-sitter` in their `config.yaml` gets **silent raw-text chunking** with no warning — a correctness footgun. This task adds a loud, explicit failure until Wave 5 (Task 15) actually wires up the real implementation.

**Files:**
- Modify: `src/core/config.ts`
- Modify: `src/core/config.test.ts`

**Step 1: Add the failing test (red)**

Open `src/core/config.test.ts` and add (adjust the exact `parseConfig`/fixture helper names to match what the file already uses — read the file first):

```typescript
it("rejects chunking: tree-sitter until the strategy is implemented", () => {
  const raw = {
    provider: { type: "letta", model: "openai/gpt-4.1", embedding: "openai/text-embedding-3-small" },
    defaults: { chunking: "tree-sitter" },
    repos: {
      "my-app": {
        path: "~/repos/my-app",
        description: "test",
        extensions: [".ts"],
        ignore_dirs: ["node_modules"],
      },
    },
  };

  expect(() => parseConfig(raw)).toThrow(ConfigError);
  expect(() => parseConfig(raw)).toThrow(/tree-sitter.*not yet implemented/i);
});
```

**Step 2: Confirm red**

```bash
pnpm test src/core/config.test.ts
```

Expected: the new test fails because `parseConfig` currently accepts `tree-sitter` without throwing.

**Step 3: Implement the guard**

In `src/core/config.ts`, inside `parseConfig`, after `validateSemantics` is checked (right after the `semanticIssues` block, before building `providerConfig`), add:

```typescript
  if (parsed.defaults?.chunking === "tree-sitter") {
    throw new ConfigError(["defaults.chunking: \"tree-sitter\" is not yet implemented — use \"raw\" (the default) or omit this field"]);
  }
```

Also add the equivalent check for the per-repo override, if `repoRawSchema` independently allows `chunking` per repo — check first with `Grep` for `chunking` inside `repoRawSchema`; if it's only a `defaults`-level field today (per the current schema shown above, it is), the single check above is sufficient — do not add per-repo logic that doesn't exist yet.

**Step 4: Confirm green**

```bash
pnpm test src/core/config.test.ts
pnpm test
pnpm typecheck
```

**Step 5: Commit**

```bash
git add src/core/config.ts src/core/config.test.ts
git commit -m "fix(config): reject chunking: tree-sitter instead of silently falling back to raw"
```

---

## Wave 4 — SDK currency

> **Sequential — Task 12 depends on Task 11's findings.** Do not upgrade the SDK before the spike is done and reviewed; this codebase has a documented history of the Letta SDK's real behavior differing from its docs (`phase-0-findings.md`, `.claude/napkin.md`).

### Task 11: Spike — audit `@letta-ai/letta-client` 1.7.8 → 1.12.1 for breaking changes

**Why:** The pinned version (`^1.7.8`) is 5 minor versions behind latest (`1.12.1`). Given this SDK's documented history of undocumented breaking changes between versions, upgrading blind is high-risk. Follow this project's own established methodology: spike first, document findings, then implement.

**Files:**
- Create: `spikes/08-letta-sdk-1.12-upgrade-check.ts` (follow the numbering and style of existing files in `spikes/`, e.g. `spikes/01-sdk-smoke-test.ts`)
- Create: `docs/plans/2026-07-03-letta-sdk-1.12-findings.md`

**This task produces a findings document, not production code changes.** No commits to `src/` in this task.

**Step 1: Read the SDK's changelog / release notes between the two versions**

```bash
npm view @letta-ai/letta-client versions --json
```

Check the package's GitHub releases page (`letta-ai/letta-client` on GitHub) for release notes between `v1.7.8` and `v1.12.1`. Pay special attention to any entries mentioning: `agents.create`, `agents.update`, `blocks.retrieve`, `blocks.update`, `passages.create`, `passages.delete`, `passages.list`, `passages.search`, `agents.list` pagination, `enable_sleeptime`, or any "BREAKING" tag.

**Step 2: Write a smoke-test spike exercising every SDK method this project actually calls**

Base this on the existing `spikes/01-sdk-smoke-test.ts` (read it first for the house style — plain script, `console.log` output, no test framework, run via `tsx`). Install the new version in an isolated way first so you don't disturb the pinned dependency yet:

```bash
mkdir -p /tmp/letta-sdk-spike && cd /tmp/letta-sdk-spike
npm init -y >/dev/null
npm install @letta-ai/letta-client@1.12.1
```

Then write `spikes/08-letta-sdk-1.12-upgrade-check.ts` in the real repo that imports from this temp install path (or temporarily bumps `package.json` in a throwaway branch — your choice, as long as `main`/the target branch is untouched until Task 12). The spike must call, at minimum, every method currently used in `src/shell/letta-provider.ts` and `src/shell/adapters/letta-admin-adapter.ts` (grep both files for `this.client.` and `client.` to get the exact list) against a real or mocked Letta Cloud endpoint, and log the actual response shape for each.

**Step 3: Run the spike against a real Letta Cloud test account if `LETTA_API_KEY` is available in the environment; otherwise inspect the SDK's own TypeScript type definitions for signature changes**

```bash
LETTA_API_KEY=<key> npx tsx spikes/08-letta-sdk-1.12-upgrade-check.ts
```

If no live key is available, at minimum diff the TypeScript signatures:

```bash
diff <(cd /workspace && node -e "console.log(require('@letta-ai/letta-client/package.json').version)") \
     <(cd /tmp/letta-sdk-spike && node -e "console.log(require('@letta-ai/letta-client/package.json').version)")
# Then manually compare node_modules/@letta-ai/letta-client/**/*.d.ts between the two installs
# for every method listed in Step 2.
```

**Step 4: Write the findings document**

Create `docs/plans/2026-07-03-letta-sdk-1.12-findings.md` following the exact structure of `phase-0-findings.md` (Executive Summary, a table of "Spec Assumed / Verified Reality" for anything that changed, a Risk table for anything uncertain). At minimum answer:

- Did any method signature used by this codebase change (name, argument order, argument shape, return shape)?
- Did any error/exception type or shape change?
- Are there new required parameters on `agents.create` or `passages.create`?
- Does `enable_sleeptime` still work the same way?
- Any new deprecation warnings when calling the methods this project uses?

**Step 5: STOP and report.** Do not proceed to Task 12 until this findings document exists and states either "safe to upgrade with no code changes" or lists the exact code changes required.

**Step 6: Commit only the spike + findings doc (not any dependency bump)**

```bash
git add spikes/08-letta-sdk-1.12-upgrade-check.ts docs/plans/2026-07-03-letta-sdk-1.12-findings.md
git commit -m "docs: spike Letta SDK 1.7.8→1.12.1 upgrade path, document findings"
```

---

### Task 12: Upgrade `@letta-ai/letta-client` to 1.12.1

**Why:** Close the 5-minor-version gap identified in Task 11, applying whatever code changes that spike's findings document specified.

**Precondition:** Task 11's findings document exists and has been read.

**Files:**
- Modify: `package.json`
- Modify: any of `src/shell/letta-provider.ts`, `src/shell/adapters/letta-admin-adapter.ts`, `src/mcp-server.ts` — **only** if Task 11's findings document says a specific method signature changed. Do not speculatively change code the findings document didn't flag.
- Modify: `.claude/napkin.md` — add a dated entry to the Corrections table for anything the spike discovered that wasn't previously known (following the existing table format/style exactly).

**Step 1: Bump the dependency**

```bash
pnpm add @letta-ai/letta-client@1.12.1
```

**Step 2: Run the full test suite (red, if the findings predicted breakage)**

```bash
pnpm test
pnpm typecheck
```

If Task 11 found no breaking changes, this should already be green — in that case skip to Step 4.

**Step 3: If tests fail, apply exactly the fixes Task 11's findings document specified**

For each affected call site, update the code to match the new signature/shape, following the existing pattern in the file (e.g. how `letta-provider.ts`'s `withRetry` wraps calls — keep new/changed calls wrapped the same way). Add or update the corresponding unit test in the sibling `.test.ts` file for each change, mocking the new response shape.

**Step 4: Confirm green**

```bash
pnpm lint
pnpm typecheck
pnpm test
```

**Step 5: Update `.claude/napkin.md`**

Add a row to the `## Corrections` table (matching its existing `| Date | Source | What Went Wrong | What To Do Instead |` format) for any genuinely new discovery from the spike, e.g.:

```
| 2026-07-03 | self | <what was wrong/different in 1.12.1> | <what to do instead> |
```

If the spike found no discrepancies at all, skip this step.

**Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml
# plus any src/ files changed in Step 3, plus .claude/napkin.md if updated in Step 5
git commit -m "chore(deps): upgrade @letta-ai/letta-client 1.7.8 -> 1.12.1"
```

If Step 3 required source changes, split them into a separate preceding commit (e.g. `fix(letta-provider): adapt to <method> signature change in SDK 1.12.1`) so the dependency bump commit itself stays a pure version bump.

---

## Wave 5 — Retrieval quality: tree-sitter chunking

> **Sequential, high-risk, largest slice in this plan.** This wave directly addresses the single biggest value-add gap identified in the audit (`docs/research-audit.md` §5.1): raw ~2KB text chunking is the weakest link versus every serious competitor. Follow the spike-first pattern strictly — do not jump to Task 14 without Task 13's findings.
>
> **Scope guardrail:** this wave targets **TypeScript/JavaScript only** (the project's own source is TS, and it's the most common language in target repos per `config.example.yaml`'s examples). Do not attempt to support all 40+ tree-sitter grammars in one slice — that is future work, not this plan.

### Task 13: Spike — tree-sitter feasibility for TypeScript/JavaScript chunking

**Why:** Confirm the concrete library, API, and chunking approach before writing production code, matching this project's existing spike discipline.

**Files:**
- Create: `spikes/09-tree-sitter-chunking.ts`
- Create: `docs/plans/2026-07-03-tree-sitter-chunking-findings.md`

**This task produces a findings document, not production code.** No `src/` commits in this task.

**Step 1: Install `web-tree-sitter` and the TypeScript grammar as a throwaway dependency for the spike**

```bash
pnpm add -D web-tree-sitter tree-sitter-typescript
```

(Do not treat this as final — Task 14 will formalize whichever dependency the spike confirms works, which may differ, e.g. `tree-sitter` native bindings vs. `web-tree-sitter` WASM bindings. Note the trade-off in the findings doc: WASM bindings avoid native-binary compilation issues across platforms/architectures, which matters for a CLI tool distributed as an npm package and as SEA binaries — this is a build-portability concern this codebase already cares about, per `scripts/build-sea.sh`.)

**Step 2: Write the spike**

Following the style of `spikes/04b-retrieval-debug.ts` (read it first), write a script that:

1. Parses a handful of real files from this repo itself (e.g. `src/core/chunker.ts`, `src/shell/sync.ts`, `src/cli.ts` — pick one small, one medium, one large file by line count) using the TypeScript tree-sitter grammar.
2. Extracts top-level symbol boundaries: function declarations, class declarations, interface/type declarations, exported `const` arrow functions.
3. For each symbol, produces a chunk with a structural prefix, e.g. `FILE: src/core/chunker.ts | FUNCTION: chunkFile` or `FILE: src/shell/sync.ts | CLASS: SyncOrchestrator | METHOD: run` (adjust exact prefix format based on what reads clearly — this becomes the passage text prefix, replacing today's plain `FILE: <path>` prefix from `FILE_PREFIX` in `src/core/types.ts`).
4. Logs: total symbols extracted per file, average chunk size, and any code that fails to parse (syntax the grammar doesn't handle) or produces zero symbols (e.g. a file that's 100% top-level statements with no functions/classes — decide and document a fallback: fall back to `rawTextStrategy`'s double-newline splitting for such files).

**Step 3: Run it**

```bash
npx tsx spikes/09-tree-sitter-chunking.ts
```

**Step 4: Write the findings document**

Create `docs/plans/2026-07-03-tree-sitter-chunking-findings.md`, structured like `phase-0-findings.md`. It must answer:

- Which library (`web-tree-sitter` + WASM grammar, vs. native `tree-sitter`/`tree-sitter-typescript` bindings)? State the decision and why, focusing on: (a) whether it works when bundled by `esbuild` for both the ESM (`dist/cli.mjs`) and SEA/CJS (`dist/sea-cli.cjs`) build targets in `scripts/build.ts`, and (b) whether it introduces any native-compilation step that would break `pnpm install` on a machine without build tools.
- What is the exact chunk-prefix format? (This becomes the passage text format stored in Letta/Viking archival memory — changing it affects retrieval quality, so pin down the final format before Task 14.)
- What's the fallback behavior for files with zero extractable top-level symbols, and for `.js`/`.jsx` files vs `.ts`/`.tsx` (does the grammar handle both, or do you need two grammars)?
- Does parsing add meaningful latency at the scale `setup` already handles (thousands of files)? Time the spike's parse step across a few dozen files and extrapolate.
- Any files in this repo itself that fail to parse or produce degenerate output?

**Step 5: STOP and report.** Do not proceed to Task 14 until this document exists with a clear, single recommended approach (library + prefix format + fallback rule).

**Step 6: Commit**

```bash
git add spikes/09-tree-sitter-chunking.ts docs/plans/2026-07-03-tree-sitter-chunking-findings.md
git commit -m "docs: spike tree-sitter chunking feasibility for TS/JS, document findings"
```

(Do not commit the throwaway `pnpm add -D web-tree-sitter tree-sitter-typescript` dependency bump from Step 1 if Task 13's findings recommend a different library than what you installed for exploration — `pnpm remove` whichever packages the findings doc didn't confirm as the final choice, before this commit.)

---

### Task 14: Implement `treeSitterStrategy` chunker

**Precondition:** Task 13's findings document exists, with a confirmed library and chunk-prefix format.

**Files:**
- Create: `src/core/tree-sitter-chunker.ts`
- Create: `src/core/tree-sitter-chunker.test.ts`
- Modify: `src/core/types.ts` (only if the `Chunk`/`ChunkingStrategy` types need new optional fields, e.g. `symbolName`/`symbolKind` — check Task 13's findings first)
- Modify: `package.json` (add the confirmed library as a real, non-dev dependency)

**Step 1: Add failing tests first**

In `src/core/tree-sitter-chunker.test.ts`, write test cases mirroring the structure of `src/core/chunker.test.ts` (read it first — it already tests `chunkFile` and `rawTextStrategy` with simple string fixtures, no real file I/O, since this is a `src/core/` pure-function module and must stay side-effect-free per the architecture rules in `docs/architecture.md`). At minimum:

```typescript
import { describe, expect, it } from "vitest";
import { treeSitterStrategy } from "./tree-sitter-chunker.js";
import type { FileInfo } from "./types.js";

describe("treeSitterStrategy", () => {
  it("produces one chunk per top-level function declaration", () => {
    const file: FileInfo = {
      path: "src/example.ts",
      content: [
        "export function foo(): void {",
        "  console.log('foo');",
        "}",
        "",
        "export function bar(): void {",
        "  console.log('bar');",
        "}",
      ].join("\n"),
      sizeKb: 0.1,
    };

    const chunks = treeSitterStrategy(file);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text).toContain("FUNCTION: foo");
    expect(chunks[1]?.text).toContain("FUNCTION: bar");
  });

  it("falls back to raw chunking for files with no extractable symbols", () => {
    const file: FileInfo = { path: "src/data.ts", content: "export const X = 1;\nexport const Y = 2;\n", sizeKb: 0.1 };
    const chunks = treeSitterStrategy(file);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("returns an empty array for empty content", () => {
    const file: FileInfo = { path: "src/empty.ts", content: "", sizeKb: 0 };
    expect(treeSitterStrategy(file)).toEqual([]);
  });

  it("handles unparseable syntax by falling back to raw chunking instead of throwing", () => {
    const file: FileInfo = { path: "src/broken.ts", content: "function( { [ ===", sizeKb: 0.1 };
    expect(() => treeSitterStrategy(file)).not.toThrow();
  });
});
```

Adjust the exact prefix string (`"FUNCTION: foo"` above) to match whatever format Task 13's findings document pinned down — do not invent a different format here.

**Step 2: Confirm red**

```bash
pnpm test src/core/tree-sitter-chunker.test.ts
```

Expected: fails because `src/core/tree-sitter-chunker.ts` doesn't exist yet.

**Step 3: Implement**

Add the confirmed library as a real dependency:

```bash
pnpm add <whatever Task 13 confirmed, e.g. web-tree-sitter tree-sitter-typescript>
```

Write `src/core/tree-sitter-chunker.ts`. Structure it to export a `treeSitterStrategy: ChunkingStrategy` matching the exact signature of `rawTextStrategy` in `src/core/chunker.ts` (`(file: FileInfo) => Chunk[]`), so it's a drop-in replacement at every call site. Internally:

1. Parse `file.content` with the tree-sitter grammar appropriate to `file.path`'s extension (`.ts`/`.tsx` vs `.js`/`.jsx` — confirm from Task 13 whether one grammar covers both or two are needed).
2. Walk the AST for top-level function/class/interface/type declarations.
3. For each, slice the exact source text for that node's byte range and prepend the structural prefix confirmed in Task 13.
4. If zero symbols are found, or if parsing throws/fails, fall back to calling the existing `chunkFile` from `src/core/chunker.ts` (import it — this keeps `src/core/` free of duplicated chunking logic and guarantees the module stays a pure function per the architecture rules, since `chunkFile` already has no I/O).
5. Respect the same `maxChars` boundary behavior as `chunkFile` for any single symbol whose text exceeds the limit (split it the same way `chunkFile` splits on double-newlines, reusing that function rather than reimplementing).

**Important architectural constraint:** this file lives in `src/core/`, so it must have **zero side effects** — no `console.log`, no filesystem access, no network calls, deterministic output for the same input. If the confirmed tree-sitter library requires an async WASM-loading step, that loading must happen once at module scope in a way `vitest` can await, or (better, and worth flagging in Task 13's findings if not already covered) the async initialization needs to move to `src/shell/` with the pure symbol-extraction logic taking an already-initialized parser as a parameter from `src/core/`. If you hit this while implementing, re-open Task 13's findings document and add an addendum documenting the resolution, rather than silently violating the `src/core/` no-I/O rule (Task check: `pnpm test src/__tests__/architecture.test.ts` will fail if this rule is violated — treat that test as a hard gate, not a suggestion).

**Step 4: Confirm green**

```bash
pnpm test src/core/tree-sitter-chunker.test.ts
pnpm test src/__tests__/architecture.test.ts
pnpm lint
pnpm typecheck
```

**Step 5: Commit**

```bash
git add src/core/tree-sitter-chunker.ts src/core/tree-sitter-chunker.test.ts src/core/types.ts package.json pnpm-lock.yaml
git commit -m "feat(core): add treeSitterStrategy for symbol-boundary TS/JS chunking"
```

---

### Task 15: Wire `config.defaults.chunking` selection into `sync.ts` and `cli.ts`

**Precondition:** Task 14's `treeSitterStrategy` exists and passes its own tests. This task also **removes** the fail-fast guard added in Task 10 (Wave 3), replacing "reject the option" with "actually implement the option."

**Files:**
- Modify: `src/core/config.ts` (remove the Task 10 guard)
- Modify: `src/core/config.test.ts` (remove/replace the Task 10 test)
- Modify: `src/shell/sync.ts`
- Modify: `src/shell/sync.test.ts`
- Modify: `src/cli.ts`

**Step 1: Remove the Task 10 guard (this is expected to make that specific test fail — that's correct, you're replacing it)**

In `src/core/config.ts`, delete the block added in Task 10:

```typescript
  if (parsed.defaults?.chunking === "tree-sitter") {
    throw new ConfigError(["defaults.chunking: \"tree-sitter\" is not yet implemented — use \"raw\" (the default) or omit this field"]);
  }
```

In `src/core/config.test.ts`, delete the `"rejects chunking: tree-sitter until the strategy is implemented"` test added in Task 10, and replace it with a test confirming `tree-sitter` is now accepted and correctly threaded into the parsed `Config.defaults.chunking` value.

**Step 2: Add a failing test for strategy selection in `sync.ts`**

Read `src/shell/sync.ts` and `src/shell/sync.test.ts` first (they already have a `chunkingStrategy` parameter and a test titled `"uses custom chunkingStrategy when provided"` and `"defaults to rawTextStrategy when chunkingStrategy is omitted"`). Add a new test confirming that when `syncRepo`/the sync entry point is given a `Config` whose `defaults.chunking` (or per-repo override, if one exists by this point) is `"tree-sitter"`, it selects `treeSitterStrategy` instead of `rawTextStrategy` — without the caller needing to pass `chunkingStrategy` explicitly. Match the existing test's mocking style exactly.

**Step 3: Confirm red**

```bash
pnpm test src/core/config.test.ts src/shell/sync.test.ts
```

**Step 4: Implement selection logic**

Add a small pure function to `src/core/chunker.ts` (or a new tiny `src/core/chunking-selector.ts` if that reads cleaner — prefer extending `chunker.ts` unless it would need to import `tree-sitter-chunker.ts`, which is fine since both live in `src/core/`):

```typescript
import { treeSitterStrategy } from "./tree-sitter-chunker.js";

export function selectChunkingStrategy(chunking: "raw" | "tree-sitter"): ChunkingStrategy {
  return chunking === "tree-sitter" ? treeSitterStrategy : rawTextStrategy;
}
```

In `src/shell/sync.ts`, wherever `rawTextStrategy` is currently used as the default parameter value, change the call site (in `src/cli.ts`, wherever `sync.ts`'s function is invoked with the loaded `Config`) to pass `selectChunkingStrategy(repoConfig's effective chunking value)` explicitly instead of relying on the hardcoded default. Read how `RepoConfig`/`Config.defaults` currently expose `chunking` before wiring this — confirm whether it's only a `defaults`-level setting (per current schema) or needs a per-repo override path; if only global, thread `config.defaults.chunking` through.

In `src/cli.ts`, find the other hardcoded `rawTextStrategy` usage (the `chunks = files.flatMap((f) => rawTextStrategy(f))` line found during the audit) and replace it with `selectChunkingStrategy(...)` using the same config value.

**Step 5: Confirm green**

```bash
pnpm test
pnpm lint
pnpm typecheck
```

**Step 6: Commit**

```bash
git add src/core/config.ts src/core/config.test.ts src/core/chunker.ts src/shell/sync.ts src/shell/sync.test.ts src/cli.ts
git commit -m "feat: wire config.defaults.chunking to actually select raw vs tree-sitter strategy"
```

---

### Task 16: Document the tree-sitter chunking option

**Why:** Once Task 15 lands, `chunking: tree-sitter` is a real, working, user-facing feature — it needs to be documented, or it remains as invisible to users as it was when it silently no-op'd.

**Files:**
- Modify: `config.example.yaml`
- Modify: `README.md`
- Modify: `docs/architecture.md`

**No test needed** (documentation-only; `src/__tests__/lint-config.test.ts` and similar config-shape tests already cover the underlying schema in Task 14/15).

**Step 1: Update `config.example.yaml`**

Find the commented-out line:

```yaml
  # chunking: raw             # Chunking strategy: "raw" (default) or "tree-sitter"
```

Update the comment to reflect that `tree-sitter` is now implemented (not just accepted), and briefly note its scope (TypeScript/JavaScript symbol-boundary chunking; other file types fall back to raw chunking automatically):

```yaml
  # chunking: raw             # "raw" (default, ~2KB text splits) or "tree-sitter"
                               # (symbol-boundary chunking for .ts/.tsx/.js/.jsx;
                               # other file types automatically fall back to "raw")
```

**Step 2: Update `README.md`**

In the "Configuration" section's YAML example and/or the "Architecture" bullet list, add one line noting the tree-sitter chunking option exists, e.g. under "Key points":

```
- **Symbol-aware chunking** — optional `chunking: tree-sitter` mode chunks TypeScript/JavaScript at function/class boundaries instead of raw text splits, improving retrieval precision
```

**Step 3: Update `docs/architecture.md`**

In the "Data Flow" section's ASCII diagram or the surrounding prose, add a short note (2-3 sentences) that the `chunk ~2KB` step now has two strategies (`raw`, `tree-sitter`), selected via `config.defaults.chunking`, with a pointer to `src/core/tree-sitter-chunker.ts` in the "Key Files" table.

**Step 4: Verify**

```bash
grep -q "tree-sitter" config.example.yaml README.md docs/architecture.md && echo "documented in all three"
```

**Step 5: Commit**

```bash
git add config.example.yaml README.md docs/architecture.md
git commit -m "docs: document the tree-sitter chunking option"
```

---

## Wave 6 — Documentation refresh

### Task 17: Refresh competitive-landscape notes for July 2026

**Why:** `docs/research-audit.md` was written in March 2026. By July 2026, the competitive landscape moved further against this project's core differentiator (Windsurf's Devin-Desktop rebrand added "Memories/Cascade Flows" persistent codebase context; Claude Code's large context + compaction reduces reliance on external retrieval). This doesn't require rewriting the whole audit — just appending a dated addendum so future readers aren't working from stale competitive assumptions.

**Files:**
- Modify: `docs/research-audit.md`

**No test needed.**

**Step 1: Add a dated addendum section**

At the end of `docs/research-audit.md` (after the `## 9. Sources` section), add:

```markdown

---

## 10. Addendum — July 2026 Update

> Appended 2026-07-03. The competitive landscape narrowed further against this project's core "persistent memory" differentiator since the March 2026 audit above:

- **Windsurf** rebranded from Devin Desktop (June 2, 2026, Cognition AI) and ships "Memories"/"Cascade Flows" — persistent codebase context across sessions, built into the IDE, requiring zero external agent infrastructure.
- **Claude Code** continues to lean on large context windows (1M-token models now available via Letta's own model catalog) plus automatic compaction, reducing many teams' practical need for external retrieval infrastructure.
- **Letta Cloud pricing is now published and non-trivial for automated workloads**: $20/month base + $0.10/active-agent/month + $0.00015/sec tool execution, plus separate LLM provider costs — model this explicitly before scaling to many repos/teams.
- **Letta Cloud has had recurring partial outages** (13 incidents, ~6h40m downtime since Jan 2026 per public status history) and community-reported archival-memory timeouts at scale — relevant given this project positions Letta-backed memory as reliable "institutional memory."
- **Cross-repo agent messaging remains this project's most defensible, still-unreplicated differentiator** — no competing tool above offers it. The recommendation from §8 (prioritize tree-sitter chunking, then repo-expert-specific MCP tools, then PR review integration) still holds and is unaffected by the above.

See `docs/plans/2026-07-03-production-readiness-plan.md` for the concrete remediation plan covering setup, maintainability, security, and this wave of value-add work.
```

**Step 2: Verify**

```bash
grep -q "Addendum — July 2026" docs/research-audit.md && echo "addendum present"
```

**Step 3: Commit**

```bash
git add docs/research-audit.md
git commit -m "docs: append July 2026 competitive-landscape addendum to research audit"
```

---

## Completion checklist

Run this after all waves are done, as a final end-to-end sanity check:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm audit --prod
test -f LICENSE && echo "LICENSE present"
node -e "const p=require('./package.json'); console.log('engines:', JSON.stringify(p.engines))"
```

Expected: lint/typecheck/test all exit 0; `pnpm audit --prod` shows zero or near-zero advisories (Task 6's `hono` chain may have residual advisories if Step 4 of that task had to fall back to "revert and report" — that is an acceptable, documented exception, not a plan failure); `LICENSE` exists; `engines.node` is set.
