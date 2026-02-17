import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_CACHE_KEY, InMemoryAnswerCache, toModelCacheKey } from "./answer-cache.js";

describe("toModelCacheKey", () => {
  it("returns the default key when model is omitted", () => {
    expect(toModelCacheKey(undefined)).toBe(DEFAULT_MODEL_CACHE_KEY);
  });

  it("returns trimmed model when provided", () => {
    expect(toModelCacheKey(" openai/gpt-4.1-mini ")).toBe("openai/gpt-4.1-mini");
  });
});

describe("InMemoryAnswerCache", () => {
  it("stores and retrieves entries by normalized question", () => {
    let now = 1_000;
    const cache = new InMemoryAnswerCache(1_000, () => now);
    cache.set(
      {
        agentId: "agent-1",
        question: "Where is  auth middleware?",
        modelKey: "openai/gpt-4.1-mini",
        lastSyncCommit: "abc",
      },
      "src/auth.ts",
    );

    const hit = cache.get({
      agentId: "agent-1",
      question: "where is auth middleware?",
      modelKey: "openai/gpt-4.1-mini",
      lastSyncCommit: "abc",
    });
    expect(hit).toBe("src/auth.ts");
  });

  it("returns null after ttl expiry", () => {
    let now = 1_000;
    const cache = new InMemoryAnswerCache(100, () => now);
    cache.set(
      {
        agentId: "agent-1",
        question: "q",
        modelKey: "m",
        lastSyncCommit: null,
      },
      "answer",
    );

    now = 1_200;
    const hit = cache.get({
      agentId: "agent-1",
      question: "q",
      modelKey: "m",
      lastSyncCommit: null,
    });
    expect(hit).toBeNull();
  });

  it("isolates entries by commit and model", () => {
    const cache = new InMemoryAnswerCache(1_000);
    cache.set(
      {
        agentId: "agent-1",
        question: "q",
        modelKey: "fast-model",
        lastSyncCommit: "abc",
      },
      "fast",
    );

    expect(
      cache.get({
        agentId: "agent-1",
        question: "q",
        modelKey: "default-model",
        lastSyncCommit: "abc",
      }),
    ).toBeNull();

    expect(
      cache.get({
        agentId: "agent-1",
        question: "q",
        modelKey: "fast-model",
        lastSyncCommit: "def",
      }),
    ).toBeNull();
  });
});
