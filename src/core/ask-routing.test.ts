import { describe, expect, it } from "vitest";
import { buildAskRoutePlan, isSimpleQuestion, parseAskRoutingMode } from "./ask-routing.js";

describe("parseAskRoutingMode", () => {
  it("defaults to auto", () => {
    expect(parseAskRoutingMode(undefined)).toBe("auto");
  });

  it("accepts known modes", () => {
    expect(parseAskRoutingMode("auto")).toBe("auto");
    expect(parseAskRoutingMode("quality")).toBe("quality");
    expect(parseAskRoutingMode("speed")).toBe("speed");
  });

  it("throws on unknown mode", () => {
    expect(() => parseAskRoutingMode("unknown")).toThrow("Invalid routing mode");
  });
});

describe("isSimpleQuestion", () => {
  it("returns true for short single-line questions", () => {
    expect(isSimpleQuestion("Where is auth middleware?")).toBe(true);
  });

  it("returns false for multi-line questions", () => {
    expect(isSimpleQuestion("Question line 1\nline2")).toBe(false);
  });

  it("returns false for complexity hints", () => {
    expect(isSimpleQuestion("Compare architecture tradeoffs for migration")).toBe(false);
  });
});

describe("buildAskRoutePlan", () => {
  it("uses fast model in auto mode for simple questions", () => {
    const plan = buildAskRoutePlan({
      routing: "auto",
      question: "Where is auth middleware?",
      fastModel: "openai/gpt-4.1-mini",
      askTimeoutMs: 20_000,
      fastAskTimeoutMs: 8_000,
    });
    expect(plan.primaryOverrideModel).toBe("openai/gpt-4.1-mini");
    expect(plan.primaryTimeoutMs).toBe(8_000);
    expect(plan.enableFallback).toBe(true);
  });

  it("uses default model in quality mode", () => {
    const plan = buildAskRoutePlan({
      routing: "quality",
      question: "Where is auth middleware?",
      fastModel: "openai/gpt-4.1-mini",
      askTimeoutMs: 20_000,
      fastAskTimeoutMs: 8_000,
    });
    expect(plan.primaryOverrideModel).toBeUndefined();
    expect(plan.enableFallback).toBe(false);
  });

  it("falls back to default model when fast model is missing", () => {
    const plan = buildAskRoutePlan({
      routing: "speed",
      question: "Where is auth middleware?",
      fastModel: undefined,
      askTimeoutMs: 20_000,
      fastAskTimeoutMs: 8_000,
    });
    expect(plan.primaryOverrideModel).toBeUndefined();
    expect(plan.enableFallback).toBe(false);
  });
});
