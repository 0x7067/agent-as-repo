/**
 * Quality assessment spike — measures agent response accuracy and latency.
 *
 * Run: pnpm tsx spikes/quality-assessment.ts
 * Requires: LETTA_API_KEY set in .env or environment
 */
import "dotenv/config";
import { Letta } from "@letta-ai/letta-client";
import { LettaProvider } from "../src/shell/letta-provider.js";
import { loadState } from "../src/shell/state-store.js";

const STATE_FILE = ".repo-expert-state.json";

interface AssessmentCase {
  repo: string;
  question: string;
  expectedKeywords: string[];
}

const CASES: AssessmentCase[] = [
  {
    repo: "agent-as-repo",
    question: "What package manager does this project use and how do you run tests?",
    expectedKeywords: ["pnpm", "vitest"],
  },
  {
    repo: "mobile",
    question: "What framework is the mobile app built with?",
    expectedKeywords: ["expo", "react native"],
  },
  {
    repo: "datatransferhub",
    question: "What cloud services does this project use for data transfer?",
    expectedKeywords: ["s3", "sqs", "lambda"],
  },
  {
    repo: "zc-blitz-2",
    question: "What web framework is this project built on?",
    expectedKeywords: ["blitz", "next"],
  },
  {
    repo: "claude-code-metrics",
    question: "What observability tools does this project use?",
    expectedKeywords: ["prometheus", "grafana"],
  },
];

interface Result {
  repo: string;
  latencyMs: number;
  passed: boolean;
  matchedKeyword: string | null;
  snippet: string;
  error?: string;
}

async function run(): Promise<void> {
  if (!process.env["LETTA_API_KEY"]) {
    console.error("Missing LETTA_API_KEY — set it in .env or environment.");
    process.exit(1);
  }

  const state = await loadState(STATE_FILE);
  const client = new Letta({ apiKey: process.env["LETTA_API_KEY"] });
  const provider = new LettaProvider(client);

  console.log("\nQuality Assessment — 5 Agents\n");

  const results: Result[] = [];

  for (const c of CASES) {
    const agentState = state.agents[c.repo];
    if (!agentState) {
      results.push({
        repo: c.repo,
        latencyMs: 0,
        passed: false,
        matchedKeyword: null,
        snippet: "",
        error: "agent not found in state",
      });
      continue;
    }

    process.stdout.write(`  ${c.repo} … `);
    const t0 = performance.now();

    try {
      const response = await provider.sendMessage(agentState.agentId, c.question);
      const latencyMs = Math.round(performance.now() - t0);

      const lower = response.toLowerCase();
      const matchedKeyword = c.expectedKeywords.find((kw) => lower.includes(kw)) ?? null;
      const passed = matchedKeyword !== null;
      const snippet = response.slice(0, 200).replace(/\n/g, " ");

      results.push({ repo: c.repo, latencyMs, passed, matchedKeyword, snippet });
      console.log(`${latencyMs}ms — ${passed ? "PASS" : "FAIL"}`);
    } catch (err) {
      const latencyMs = Math.round(performance.now() - t0);
      const error = err instanceof Error ? err.message : String(err);
      results.push({ repo: c.repo, latencyMs, passed: false, matchedKeyword: null, snippet: "", error });
      console.log(`${latencyMs}ms — ERROR`);
    }
  }

  // Summary table
  const pad = (s: string, n: number) => s.padEnd(n);
  const sep = "─".repeat(100);
  console.log(`\n${sep}`);
  console.log(
    `${pad("Repo", 24)} ${pad("Latency", 10)} ${pad("Result", 8)} ${pad("Keyword", 14)} Snippet / Error`,
  );
  console.log(sep);

  for (const r of results) {
    const latency = r.error ? "—" : `${r.latencyMs}ms`;
    const result = r.error ? "ERROR" : r.passed ? "PASS" : "FAIL";
    const keyword = r.matchedKeyword ?? (r.error ? r.error.slice(0, 12) : "—");
    const detail = r.error ?? r.snippet;
    console.log(
      `${pad(r.repo, 24)} ${pad(latency, 10)} ${pad(result, 8)} ${pad(keyword, 14)} ${detail.slice(0, 50)}`,
    );
  }

  const passed = results.filter((r) => r.passed).length;
  console.log(sep);
  console.log(`\n${passed}/${results.length} agents passed keyword check`);

  if (passed < results.length) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
