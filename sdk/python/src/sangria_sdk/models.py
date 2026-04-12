from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

MICROUNITS_PER_DOLLAR: int = 1_000_000
"""Number of microunits in 1 USD."""


_MAX_SAFE_MICROUNITS: int = 9_007_199_254_740_991  # JS Number.MAX_SAFE_INTEGER


def to_microunits(dollars: float) -> int:
    """Convert a dollar amount to microunits. Rounds half-up to match JS Math.round."""
    from decimal import Decimal, ROUND_HALF_UP
    microunits = int((Decimal(str(dollars)) * Decimal(MICROUNITS_PER_DOLLAR)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if microunits <= 0:
        raise ValueError("amount must be a positive integer (microunits)")
    if microunits > _MAX_SAFE_MICROUNITS:
        raise ValueError(
            "amount exceeds safe integer range for JSON transport and cannot be represented safely"
        )
    return microunits


def from_microunits(microunits: int) -> float:
    """Convert microunits to dollars (for display purposes only)."""
    return microunits / MICROUNITS_PER_DOLLAR


@dataclass(slots=True)
class FixedPriceOptions:
    """Price in dollars (e.g. 0.01 for one cent). Converted to microunits internally before sending to the backend."""
    price: float
    resource: str
    description: str | None = None

    def __post_init__(self) -> None:
        import math
        if isinstance(self.price, bool) or not isinstance(self.price, (int, float)) or not math.isfinite(self.price) or self.price <= 0:
            raise ValueError("price must be a positive number (dollars)")

    def to_generate_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "amount": to_microunits(self.price),
            "resource": self.resource,
        }
        if self.description:
            payload["description"] = self.description
        return payload


@dataclass(slots=True)
class PaymentResponse:
    """Return this as an HTTP response — payment not yet completed."""
    status_code: int
    body: dict[str, Any]
    headers: dict[str, str] = field(default_factory=dict)


@dataclass(slots=True)
class PaymentProceeded:
    """Payment succeeded — run the handler."""
    paid: bool
    amount: float
    """Amount charged in dollars."""
    transaction: str | None = None


PaymentResult = PaymentResponse | PaymentProceeded
