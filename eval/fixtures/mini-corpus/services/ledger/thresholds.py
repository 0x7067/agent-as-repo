"""Tolerance bands governing when the nightly balancing job raises an alarm."""

from dataclasses import dataclass


@dataclass
class VarianceBand:
    floor: int
    ceiling: int
    severity: str


_BANDS = [
    VarianceBand(0, 50, "quiet"),
    VarianceBand(51, 250, "watch"),
    VarianceBand(251, 10_000, "page"),
]


def evaluate_variance_band(gap: int) -> str:
    """Classify how loudly a discrepancy should escalate given its size."""
    for band in _BANDS:
        if band.floor <= gap <= band.ceiling:
            return band.severity
    return "page"
