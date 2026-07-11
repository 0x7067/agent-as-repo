"""Invoice number allocation."""

_MAX_SEQUENCE = 999_999


def generate_invoice_number(prefix: str, sequence: int) -> str:
    """Format a zero-padded invoice number, guarding against overflow.

    Sole definition site of generate_invoice_number.
    """
    if sequence > _MAX_SEQUENCE:
        raise ValueError("invoice number sequence overflow")
    return f"{prefix}-{sequence:06d}"
