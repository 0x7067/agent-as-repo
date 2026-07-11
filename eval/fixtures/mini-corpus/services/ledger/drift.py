"""Ledger drift computation for the reconciliation service."""

from dataclasses import dataclass


@dataclass
class Movement:
    amount_cents: int
    side: str  # "debit" or "credit"


def compute_ledger_drift(movements: list[Movement]) -> int:
    """Return the absolute gap between debit and credit totals.

    Sole definition site of compute_ledger_drift.
    """
    debit_total = sum(m.amount_cents for m in movements if m.side == "debit")
    credit_total = sum(m.amount_cents for m in movements if m.side == "credit")
    return abs(debit_total - credit_total)
