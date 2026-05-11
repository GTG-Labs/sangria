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
    max_timeout_seconds: int | None = None

    def __post_init__(self) -> None:
        import math
        if isinstance(self.price, bool) or not isinstance(self.price, (int, float)) or not math.isfinite(self.price) or self.price <= 0:
            raise ValueError("price must be a positive number (dollars)")
        if self.max_timeout_seconds is not None:
            if isinstance(self.max_timeout_seconds, bool) or not isinstance(self.max_timeout_seconds, int):
                raise TypeError("max_timeout_seconds must be an integer")
            if self.max_timeout_seconds <= 0 or self.max_timeout_seconds > 900:
                raise ValueError("max_timeout_seconds must be a positive integer <= 900")

    def to_generate_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "amount": to_microunits(self.price),
            "resource": self.resource,
        }
        if self.description:
            payload["description"] = self.description
        if self.max_timeout_seconds is not None:
            payload["max_timeout_seconds"] = self.max_timeout_seconds
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
    network: str | None = None
    """CAIP-2 network identifier (e.g. "eip155:8453")."""
    payer: str | None = None
    """Payer wallet address."""
    headers: dict[str, str] = field(default_factory=dict)


PaymentResult = PaymentResponse | PaymentProceeded


@dataclass(slots=True)
class UptoPriceOptions:
    """Maximum price in dollars (e.g. 0.10 for ten cents). The agent authorizes up to this amount."""
    max_price: float
    resource: str
    description: str | None = None
    max_timeout_seconds: int | None = None

    def __post_init__(self) -> None:
        import math
        if isinstance(self.max_price, bool) or not isinstance(self.max_price, (int, float)) or not math.isfinite(self.max_price) or self.max_price <= 0:
            raise ValueError("max_price must be a positive number (dollars)")
        if self.max_timeout_seconds is not None:
            if isinstance(self.max_timeout_seconds, bool) or not isinstance(self.max_timeout_seconds, int):
                raise TypeError("max_timeout_seconds must be an integer")
            if self.max_timeout_seconds <= 0 or self.max_timeout_seconds > 900:
                raise ValueError("max_timeout_seconds must be a positive integer <= 900")

    def to_generate_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "scheme": "upto",
            "max_amount": to_microunits(self.max_price),
            "resource": self.resource,
        }
        if self.description:
            payload["description"] = self.description
        if self.max_timeout_seconds is not None:
            payload["max_timeout_seconds"] = self.max_timeout_seconds
        return payload


@dataclass(slots=True)
class VerifyResult:
    """Result from /v1/verify-payment."""
    valid: bool
    payer: str | None = None
    reason: str | None = None
    message: str | None = None


@dataclass(slots=True)
class SettleResult:
    """Result from /v1/settle-payment for upto scheme."""
    success: bool
    transaction: str | None = None
    network: str | None = None
    payer: str | None = None
    error_reason: str | None = None
    error_message: str | None = None


_SETTLE_GUARD = object()


class Settled:
    """Opaque return value — only the settle function created by the SDK can produce instances."""
    __slots__ = ("_amount", "_body")

    def __init__(self, _guard: object, amount: float, body: Any) -> None:
        if _guard is not _SETTLE_GUARD:
            raise TypeError(
                "Settled cannot be instantiated directly — use the settle() function provided by the SDK"
            )
        self._amount = amount
        self._body = body
