import { normalizeQuestion } from "../core/ask-routing.js";

interface CacheEntry {
  answer: string;
  expiresAtMs: number;
}

export interface AnswerCacheKey {
  agentId: string;
  question: string;
  modelKey: string;
  lastSyncCommit: string | null;
}

export const DEFAULT_MODEL_CACHE_KEY = "__agent_default__";

export function toModelCacheKey(model: string | undefined): string {
  const trimmed = model?.trim();
  return trimmed ? trimmed : DEFAULT_MODEL_CACHE_KEY;
}

function toCacheKey(parts: AnswerCacheKey): string {
  const commit = parts.lastSyncCommit ?? "no-sync-commit";
  return [
    parts.agentId,
    parts.modelKey,
    commit,
    normalizeQuestion(parts.question),
  ].join("::");
}

export class InMemoryAnswerCache {
  private readonly store = new Map<string, CacheEntry>();

  constructor(
    private readonly defaultTtlMs: number,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  get(parts: AnswerCacheKey): string | null {
    const key = toCacheKey(parts);
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs <= this.nowMs()) {
      this.store.delete(key);
      return null;
    }
    return entry.answer;
  }

  set(parts: AnswerCacheKey, answer: string, ttlMs?: number): void {
    const key = toCacheKey(parts);
    const ttl = ttlMs ?? this.defaultTtlMs;
    this.store.set(key, {
      answer,
      expiresAtMs: this.nowMs() + Math.max(1, ttl),
    });
  }

  clear(): void {
    this.store.clear();
  }
}
