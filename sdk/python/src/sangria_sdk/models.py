from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

MICROUNITS_PER_DOLLAR: int = 1_000_000
"""Number of microunits in 1 USD."""


def to_microunits(dollars: float) -> int:
    """Convert a dollar amount to microunits. Rounds to nearest integer."""
    return round(dollars * MICROUNITS_PER_DOLLAR)


def from_microunits(microunits: int) -> float:
    """Convert microunits to dollars (for display purposes only)."""
    return microunits / MICROUNITS_PER_DOLLAR


@dataclass(slots=True)
class FixedPriceOptions:
    """Price in microunits (1 USD = 1_000_000 microunits). Must be a positive integer."""
    price: int
    resource: str
    description: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.price, int) or isinstance(self.price, bool) or self.price <= 0:
            raise ValueError("price must be a positive integer (microunits)")

    def to_generate_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "amount": self.price,
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
    amount: int
    """Amount charged in microunits (1 USD = 1_000_000 microunits)."""
    transaction: str | None = None


PaymentResult = PaymentResponse | PaymentProceeded
