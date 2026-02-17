export const ASK_ROUTING_MODES = ["auto", "quality", "speed"] as const;
export type AskRoutingMode = (typeof ASK_ROUTING_MODES)[number];

export const ASK_DEFAULT_TIMEOUT_MS = 20_000;
export const ASK_DEFAULT_FAST_TIMEOUT_MS = 8_000;
export const ASK_DEFAULT_CACHE_TTL_MS = 180_000;

const COMPLEXITY_HINTS = [
  "architecture",
  "design",
  "tradeoff",
  "compare",
  "cross-repo",
  "migration",
  "security",
  "performance",
  "benchmark",
  "root cause",
  "incident",
  "multi-step",
];

export interface AskRoutePlan {
  primaryOverrideModel?: string;
  primaryTimeoutMs: number;
  fallbackOverrideModel?: string;
  fallbackTimeoutMs: number;
  enableFallback: boolean;
}

export function normalizeQuestion(question: string): string {
  return question.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isSimpleQuestion(question: string): boolean {
  const trimmed = question.trim();
  if (!trimmed) return false;
  if (trimmed.length > 280) return false;
  if (trimmed.includes("\n")) return false;
  const normalized = normalizeQuestion(trimmed);
  return !COMPLEXITY_HINTS.some((hint) => normalized.includes(hint));
}

export function parseAskRoutingMode(value: string | undefined): AskRoutingMode {
  if (!value) return "auto";
  if (value === "auto" || value === "quality" || value === "speed") {
    return value;
  }
  throw new Error(`Invalid routing mode "${value}". Use one of: auto, quality, speed.`);
}

export function buildAskRoutePlan(params: {
  routing: AskRoutingMode;
  question: string;
  fastModel?: string;
  askTimeoutMs: number;
  fastAskTimeoutMs: number;
}): AskRoutePlan {
  const trimmedFastModel = params.fastModel?.trim();
  const hasFastModel = Boolean(trimmedFastModel);
  const useFast =
    hasFastModel &&
    (params.routing === "speed" || (params.routing === "auto" && isSimpleQuestion(params.question)));

  if (useFast) {
    return {
      primaryOverrideModel: trimmedFastModel,
      primaryTimeoutMs: params.fastAskTimeoutMs,
      fallbackOverrideModel: undefined,
      fallbackTimeoutMs: params.askTimeoutMs,
      enableFallback: true,
    };
  }

  return {
    primaryOverrideModel: undefined,
    primaryTimeoutMs: params.askTimeoutMs,
    fallbackOverrideModel: undefined,
    fallbackTimeoutMs: params.askTimeoutMs,
    enableFallback: false,
  };
}
