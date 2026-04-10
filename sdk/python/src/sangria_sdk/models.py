from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class FixedPriceOptions:
    price: float
    resource: str
    description: str | None = None

    def __post_init__(self) -> None:
        import math

        if (
            not isinstance(self.price, (int, float))
            or not math.isfinite(self.price)
            or self.price <= 0
        ):
            raise ValueError("price must be a finite number greater than 0")

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
    amount: float
    transaction: str | None = None


PaymentResult = PaymentResponse | PaymentProceeded
