export interface CheckResult {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
}

const STATUS_LABELS: Record<CheckResult["status"], string> = {
  pass: "PASS",
  fail: "FAIL",
  warn: "WARN",
};

export function formatDoctorReport(results: CheckResult[]): string {
  if (results.length === 0) return "No checks ran.";

  const lines: string[] = [];
  for (const r of results) {
    lines.push(`  ${STATUS_LABELS[r.status]}  ${r.name}: ${r.message}`);
  }

  const issues = results.filter((r) => r.status !== "pass").length;
  if (issues === 0) {
    lines.push(`\nAll checks passed.`);
  } else {
    lines.push(`\n${issues} issue${issues > 1 ? "s" : ""} found.`);
  }

  return lines.join("\n");
}
