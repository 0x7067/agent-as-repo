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
    // First line should be a check result, not "Stryker was here" (catches ArrayDeclaration mutation)
    const firstLine = report.split("\n")[0];
    expect(firstLine).toContain("PASS");
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

  it("uses singular 'issue' for exactly one problem", () => {
    const results: CheckResult[] = [
      { name: "A", status: "fail", message: "bad" },
    ];
    const report = formatDoctorReport(results);
    expect(report).toContain("1 issue found.");
    expect(report).not.toContain("1 issues");
  });

  it("joins lines with newline separator (not empty string)", () => {
    // Catches: join("\n") → join("") mutation
    const results: CheckResult[] = [
      { name: "A", status: "pass", message: "ok" },
      { name: "B", status: "pass", message: "ok" },
    ];
    const report = formatDoctorReport(results);
    // With join("\n"): "  PASS  A: ok\n  PASS  B: ok\n\nAll checks passed."
    // With join(""): "  PASS  A: ok  PASS  B: ok\nAll checks passed."
    // The first two check lines should be separated by \n
    expect(report).toContain("A: ok\n  PASS  B:");
  });

  it("handles empty results", () => {
    const report = formatDoctorReport([]);
    expect(report).toContain("No checks ran");
  });
});
