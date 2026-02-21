/**
 * Model comparison spike — benchmarks candidate models for quality and latency.
 *
 * Run: pnpm tsx spikes/model-comparison.ts
 * Requires: LETTA_API_KEY set in .env or environment
 *
 * Tests each model against the agent-as-repo agent using override_model.
 * Measures latency per call and quality (keyword pass rate across 3 questions).
 */
import "dotenv/config";
import { Letta } from "@letta-ai/letta-client";
import { LettaProvider } from "../src/shell/letta-provider.js";
import { loadState } from "../src/shell/state-store.js";

const STATE_FILE = ".repo-expert-state.json";
const TARGET_REPO = "agent-as-repo";

interface Question {
  text: string;
  keywords: string[]; // ALL must appear (case-insensitive) for a pass
}

const QUESTIONS: Question[] = [
  {
    text: "What package manager does this project use and how do you run tests?",
    keywords: ["pnpm", "vitest"],
  },
  {
    text: "Explain the provider abstraction in src/shell/provider.ts",
    keywords: ["agentprovider", "interface"],
  },
  {
    text: "How does the sync command detect which files changed?",
    keywords: ["git", "diff"],
  },
];

interface CandidateModel {
  tier: "normal" | "fast";
  model: string;
  baseline?: boolean;
}

const CANDIDATES: CandidateModel[] = [
  // Normal tier
  { tier: "normal", model: "chatgpt-plus-pro/gpt-5.2" },
  { tier: "normal", model: "chatgpt-plus-pro/gpt-5.1", baseline: true },
  { tier: "normal", model: "lc-zai/glm-5" },
  { tier: "normal", model: "lc-zai/glm-4.7" },
  // Fast tier
  { tier: "fast", model: "chatgpt-plus-pro/gpt-5.3-codex" },
  { tier: "fast", model: "chatgpt-plus-pro/gpt-5.2-codex" },
  { tier: "fast", model: "chatgpt-plus-pro/gpt-5.1-codex", baseline: true },
  { tier: "fast", model: "chatgpt-plus-pro/gpt-5.1-codex-mini" },
  { tier: "fast", model: "chatgpt-plus-pro/gpt-5-codex-mini" },
  { tier: "fast", model: "lc-zai/glm-4.6" },
  { tier: "fast", model: "lc-zai/glm-4.5" },
];

interface QuestionResult {
  passed: boolean;
  latencyMs: number;
  missingKeywords: string[];
}

interface ModelResult {
  tier: "normal" | "fast";
  model: string;
  baseline: boolean;
  score: number; // 0–3
  avgLatencyMs: number;
  questions: QuestionResult[];
  error?: string;
}

function checkKeywords(response: string, keywords: string[]): string[] {
  const lower = response.toLowerCase();
  return keywords.filter((kw) => !lower.includes(kw.toLowerCase()));
}

async function testModel(
  provider: LettaProvider,
  agentId: string,
  candidate: CandidateModel,
): Promise<ModelResult> {
  const results: QuestionResult[] = [];
  let totalLatency = 0;

  for (const q of QUESTIONS) {
    const t0 = performance.now();
    try {
      const response = await provider.sendMessage(agentId, q.text, {
        overrideModel: candidate.model,
      });
      const latencyMs = Math.round(performance.now() - t0);
      totalLatency += latencyMs;
      const missing = checkKeywords(response, q.keywords);
      results.push({ passed: missing.length === 0, latencyMs, missingKeywords: missing });
    } catch (err) {
      const latencyMs = Math.round(performance.now() - t0);
      const msg = err instanceof Error ? err.message : String(err);
      return {
        tier: candidate.tier,
        model: candidate.model,
        baseline: candidate.baseline ?? false,
        score: 0,
        avgLatencyMs: latencyMs,
        questions: results,
        error: msg.slice(0, 80),
      };
    }
  }

  return {
    tier: candidate.tier,
    model: candidate.model,
    baseline: candidate.baseline ?? false,
    score: results.filter((r) => r.passed).length,
    avgLatencyMs: Math.round(totalLatency / QUESTIONS.length),
    questions: results,
  };
}

function renderTable(results: ModelResult[]): void {
  const pad = (s: string, n: number) => s.padEnd(n);
  const sep = "─".repeat(90);

  const renderTier = (tier: "normal" | "fast", label: string) => {
    const rows = results
      .filter((r) => r.tier === tier)
      .sort((a, b) => b.score - a.score || a.avgLatencyMs - b.avgLatencyMs);

    console.log(`\n${label}\n${sep}`);
    console.log(
      `${pad("Model", 38)} ${pad("Score", 8)} ${pad("Avg ms", 10)} Q1  Q2  Q3  Notes`,
    );
    console.log(sep);

    for (const r of rows) {
      const score = r.error ? "ERROR" : `${r.score}/3`;
      const latency = r.error ? "—" : `${r.avgLatencyMs}ms`;
      const qFlags = QUESTIONS.map((_, i) => {
        if (r.error && i >= r.questions.length) return " ? ";
        const q = r.questions[i];
        if (!q) return " ? ";
        return q.passed ? " ✓ " : ` ✗ `;
      }).join("");
      const notes = r.error
        ? r.error.slice(0, 30)
        : r.baseline
          ? "(baseline)"
          : r.questions
              .flatMap((q) => q.missingKeywords)
              .map((kw) => `-${kw}`)
              .join(" ");
      console.log(
        `${pad(r.model, 38)} ${pad(score, 8)} ${pad(latency, 10)} ${qFlags} ${notes}`,
      );
    }
    console.log(sep);
  };

  renderTier("normal", "NORMAL TIER (quality-first)");
  renderTier("fast", "FAST TIER (latency-first)");
}

async function run(): Promise<void> {
  if (!process.env["LETTA_API_KEY"]) {
    console.error("Missing LETTA_API_KEY — set it in .env or environment.");
    process.exit(1);
  }

  const state = await loadState(STATE_FILE);
  const agentState = state.agents[TARGET_REPO];
  if (!agentState) {
    console.error(`Agent "${TARGET_REPO}" not found in ${STATE_FILE}.`);
    process.exit(1);
  }

  const client = new Letta({ apiKey: process.env["LETTA_API_KEY"] });
  const provider = new LettaProvider(client);
  const { agentId } = agentState;

  console.log(`\nModel Comparison Spike — agent: ${TARGET_REPO} (${agentId})`);
  console.log(`Testing ${CANDIDATES.length} models × ${QUESTIONS.length} questions\n`);

  const results: ModelResult[] = [];

  for (const candidate of CANDIDATES) {
    const tag = candidate.baseline ? " [baseline]" : "";
    process.stdout.write(`  ${candidate.model}${tag} … `);

    const result = await testModel(provider, agentId, candidate);
    results.push(result);

    if (result.error) {
      console.log(`ERROR — ${result.error.slice(0, 50)}`);
    } else {
      const flags = result.questions.map((q) => (q.passed ? "✓" : "✗")).join(" ");
      console.log(`${result.score}/3  ${flags}  avg ${result.avgLatencyMs}ms`);
    }
  }

  renderTable(results);

  const total = results.length;
  const errored = results.filter((r) => r.error).length;
  const perfect = results.filter((r) => r.score === QUESTIONS.length).length;
  console.log(`\n${perfect}/${total} models scored 3/3, ${errored} errored`);
}

run().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
