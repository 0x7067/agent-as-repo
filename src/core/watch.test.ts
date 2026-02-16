import { describe, it, expect } from "vitest";
import {
  shouldSync,
  formatSyncLog,
  DEFAULT_WATCH_CONFIG,
} from "./watch.js";

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

describe("DEFAULT_WATCH_CONFIG", () => {
  it("has a 30s default interval", () => {
    expect(DEFAULT_WATCH_CONFIG.intervalMs).toBe(30_000);
  });
});
