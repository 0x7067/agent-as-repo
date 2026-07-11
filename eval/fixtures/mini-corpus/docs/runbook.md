# Nightly Balancing Runbook

When the nightly balancing job flags a gap between debit and credit books,
follow these steps:

1. Pause the batch so no further entries post while you look.
2. Examine recent entries around the flagged window.
3. Rerun matching against counterparties.
4. Page the finance on-call rotation if the gap persists past two attempts.

Most gaps clear on a second matching pass. A gap that survives paging usually
points at a duplicated import feed rather than a genuine accounting fault.
