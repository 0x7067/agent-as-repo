import { describe, it, expect } from "vitest";
import {
  DEFAULT_WATCH_CONFIG,
  shouldSync,
  formatSyncLog,
  computeBackoffDelay,
} from "./watch.js";

describe("DEFAULT_WATCH_CONFIG", () => {
  it("has expected default values", () => {
    expect(DEFAULT_WATCH_CONFIG.intervalMs).toBe(5000);
    expect(DEFAULT_WATCH_CONFIG.debounceMs).toBe(250);
  });
});

describe("shouldSync", () => {
  it("returns true when lastSyncCommit is null", () => {
    expect(shouldSync(null, "abc123")).toBe(true);
  });

  it("returns true when HEAD differs from lastSyncCommit", () => {
    expect(shouldSync("abc123", "def456")).toBe(true);
  });

  it("returns false when HEAD equals lastSyncCommit", () => {
    expect(shouldSync("abc123", "abc123")).toBe(false);
  });
});

describe("formatSyncLog", () => {
  it("formats a log line with truncated commits", () => {
    const result = formatSyncLog("my-app", "abcdef1234567890", "1234567abcdef890", 5, 2345);
    expect(result).toBe("[my-app] synced abcdef1..1234567 (5 files, 2.3s)");
  });

  it("shows 'initial' when fromCommit is null", () => {
    const result = formatSyncLog("my-app", null, "abc1234567890", 10, 500);
    expect(result).toBe("[my-app] synced initial..abc1234 (10 files, 0.5s)");
  });
});

describe("computeBackoffDelay", () => {
  it("returns 0 for zero failures", () => {
    expect(computeBackoffDelay(0, 5000)).toBe(0);
  });

  it("returns base interval for first failure", () => {
    expect(computeBackoffDelay(1, 5000)).toBe(5000);
  });

  it("grows exponentially", () => {
    expect(computeBackoffDelay(2, 5000)).toBe(10_000);
    expect(computeBackoffDelay(3, 5000)).toBe(20_000);
    expect(computeBackoffDelay(4, 5000)).toBe(40_000);
  });

  it("caps at maxDelayMs", () => {
    expect(computeBackoffDelay(10, 5000, 300_000)).toBe(300_000);
    expect(computeBackoffDelay(100, 5000, 300_000)).toBe(300_000);
  });

  it("uses default maxDelayMs of 300000", () => {
    expect(computeBackoffDelay(20, 5000)).toBe(300_000);
  });
});

