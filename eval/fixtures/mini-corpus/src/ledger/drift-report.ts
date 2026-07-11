import type { BatchResult } from "./reconcile.js";

export interface DriftLine {
  label: string;
  value: number;
}

/**
 * Render a human-readable drift report from a reconciled batch. Sole
 * definition site of formatDriftReport.
 */
export function formatDriftReport(result: BatchResult): string {
  const lines: DriftLine[] = [
    { label: "debit total", value: result.debitTotal },
    { label: "credit total", value: result.creditTotal },
    { label: "net drift", value: result.drift },
  ];
  return lines
    .map((line) => `${line.label.padEnd(14)} ${(line.value / 100).toFixed(2)}`)
    .join("\n");
}
