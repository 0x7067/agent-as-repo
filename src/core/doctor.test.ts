import { describe, it, expect } from "vitest";
import { formatDoctorReport, type CheckResult } from "./doctor.js";

describe("formatDoctorReport", () => {
  it("formats all-pass results", () => {
    const results: CheckResult[] = [
      { name: "API key", status: "pass", message: "Set in environment" },
      { name: "Config file", status: "pass", message: "config.yaml found" },
    ];
    const report = formatDoctorReport(results);
    expect(report).toContain("PASS");
    expect(report).toContain("API key");
    expect(report).toContain("Config file");
    expect(report).toContain("All checks passed");
  });

  it("formats failures", () => {
    const results: CheckResult[] = [
      { name: "API key", status: "fail", message: "LETTA_API_KEY not set" },
      { name: "Git", status: "pass", message: "git 2.40.0" },
    ];
    const report = formatDoctorReport(results);
    expect(report).toContain("FAIL");
    expect(report).toContain("LETTA_API_KEY not set");
    expect(report).not.toContain("All checks passed");
    expect(report).toContain("1 issue");
  });

  it("formats warnings", () => {
    const results: CheckResult[] = [
      { name: "State", status: "warn", message: "Agent \"old\" in state but not in config" },
    ];
    const report = formatDoctorReport(results);
    expect(report).toContain("WARN");
    expect(report).toContain("1 issue");
  });

  it("counts multiple failures", () => {
    const results: CheckResult[] = [
      { name: "A", status: "fail", message: "bad" },
      { name: "B", status: "fail", message: "also bad" },
      { name: "C", status: "pass", message: "ok" },
    ];
    const report = formatDoctorReport(results);
    expect(report).toContain("2 issues");
  });

  it("handles empty results", () => {
    const report = formatDoctorReport([]);
    expect(report).toContain("No checks ran");
  });
});
