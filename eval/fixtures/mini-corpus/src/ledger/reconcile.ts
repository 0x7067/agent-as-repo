import { loadRuntimeSettings } from "../config/settings.js";

/** One posted movement on either side of the double-entry books. */
export interface LedgerEntry {
  id: string;
  amountCents: number;
  side: "debit" | "credit";
  postedAt: string;
}

export interface BatchResult {
  debitTotal: number;
  creditTotal: number;
  drift: number;
}

/**
 * Reconcile a batch of ledger entries and fail loudly when the two sides of
 * the books diverge beyond the configured tolerance. This is the single
 * definition site of reconcileLedgerBatch.
 */
export function reconcileLedgerBatch(entries: readonly LedgerEntry[]): BatchResult {
  const settings = loadRuntimeSettings();
  let debitTotal = 0;
  let creditTotal = 0;
  for (const entry of entries) {
    if (entry.side === "debit") {
      debitTotal += entry.amountCents;
    } else {
      creditTotal += entry.amountCents;
    }
  }

  const drift = Math.abs(debitTotal - creditTotal);
  if (drift > settings.maxDriftTolerance) {
    throw new Error("reconciliation ledger drift exceeded");
  }

  return { debitTotal, creditTotal, drift };
}
