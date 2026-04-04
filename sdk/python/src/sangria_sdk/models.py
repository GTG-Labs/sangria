from __future__ import annotations

from dataclasses import dataclass, field
import copy
from decimal import Decimal
from typing import Any


def _coerce_decimal(value: Decimal | int | float | str) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


@dataclass(slots=True)
class MerchantContext:
    merchant_id: str
    resource: str
    method: str = "GET"
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class GeneratePaymentRequest:
    amount: Decimal
    resource: str
    description: str | None = None

    def __post_init__(self) -> None:
        self.amount = _coerce_decimal(self.amount)

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "amount": float(self.amount),
            "resource": self.resource,
        }
        if self.description:
            payload["description"] = self.description
        return payload


@dataclass(slots=True)
class ChallengeConfig:
    payment_id: str | None = None
    x402_version: int = 2
    description: str | None = None
    resource: str | None = None
    accepts: list[dict[str, Any]] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ChallengeConfig":
        x402_version = int(data.get("x402Version", data.get("x402_version", 2)))
        accepts = list(data.get("accepts", []))
        return cls(
            payment_id=data.get("payment_id"),
            x402_version=x402_version,
            description=data.get("description"),
            resource=data.get("resource"),
            accepts=accepts,
            raw=copy.deepcopy(data),
        )

    def to_dict(self) -> dict[str, Any]:
        if self.raw:
            return copy.deepcopy(self.raw)
        payload: dict[str, Any] = {
            "x402Version": self.x402_version,
            "accepts": self.accepts,
        }
        if self.payment_id is not None:
            payload["payment_id"] = self.payment_id
        if self.description is not None:
            payload["description"] = self.description
        if self.resource is not None:
            payload["resource"] = self.resource
        return payload


@dataclass(slots=True)
class SettlePaymentRequest:
    payment_payload: str

    def to_dict(self) -> dict[str, Any]:
        return {"payment_payload": self.payment_payload}


@dataclass(slots=True)
class SettlementResult:
    success: bool
    payment_id: str | None = None
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
            raw=data,
        )
