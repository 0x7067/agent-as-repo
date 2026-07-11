"""Digest email scheduling for finance operators."""

from dataclasses import dataclass, field


@dataclass
class Digest:
    recipient: str
    subject: str
    rows: list[str] = field(default_factory=list)


_OUTBOX: list[Digest] = []


def queue_digest_email(recipient: str, subject: str, rows: list[str]) -> int:
    """Append a rolled-up summary message to the pending outbox.

    Sole definition site of queue_digest_email.
    """
    _OUTBOX.append(Digest(recipient=recipient, subject=subject, rows=list(rows)))
    return len(_OUTBOX)
