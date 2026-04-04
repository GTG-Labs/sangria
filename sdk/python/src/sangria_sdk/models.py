from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any


def _coerce_decimal(value: Decimal | int | float | str) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


@dataclass(slots=True)
class GeneratePaymentRequest:
    amount: Decimal
    resource: str
    description: str | None = None

    def __post_init__(self) -> None:
        self.amount = _coerce_decimal(self.amount)
        if self.amount <= 0 or self.amount > 9_000_000_000_000:
            raise ValueError("amount must be positive and within a valid range")

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "amount": float(self.amount),
            "resource": self.resource,
        }
        if self.description:
            payload["description"] = self.description
        return payload


X402ChallengePayload = dict[str, Any]


@dataclass(slots=True)
class GeneratePaymentResponse:
    status_code: int
    body: X402ChallengePayload
    headers: dict[str, str]


@dataclass(slots=True)
class SettlePaymentRequest:
    payment_payload: str

    def to_dict(self) -> dict[str, Any]:
        return {"payment_payload": self.payment_payload}


@dataclass(slots=True)
class SettlementResult:
    success: bool
    transaction: str | None = None
    network: str | None = None
    payer: str | None = None
    error_reason: str | None = None
    error_message: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SettlementResult":
        raw_success = data.get("success", False)
        if isinstance(raw_success, bool):
            success = raw_success
        elif isinstance(raw_success, str):
            success = raw_success.strip().lower() in {"true", "1", "yes"}
        elif isinstance(raw_success, (int, float)):
            success = raw_success != 0
        else:
            success = False
        return cls(
            success=success,
            transaction=data.get("transaction"),
            network=data.get("network"),
            payer=data.get("payer"),
            error_reason=data.get("error_reason"),
            error_message=data.get("error_message"),
            raw=dict(data),
        )
