from __future__ import annotations

import base64
import json
import logging
import math
from collections.abc import Callable
from typing import Any

from ._http import SangriaHTTPClient
from .models import (
    FixedPriceOptions,
    PaymentProceeded,
    PaymentResponse,
    PaymentResult,
    Settled,
    SettleResult,
    UptoPriceOptions,
    VerifyResult,
    _SETTLE_GUARD,
)

logger = logging.getLogger("sangria_sdk")


def validate_fixed_price_options(options: FixedPriceOptions) -> None:
    """Raise ValueError if options are invalid. Called at adapter construction."""
    if (
        isinstance(options.price, bool)
        or not isinstance(options.price, (int, float))
        or not math.isfinite(options.price)
        or options.price <= 0
    ):
        raise ValueError("Sangria: price must be a positive number (dollars)")


class SangriaMerchantClient:
    _DEFAULT_BASE_URL = "https://api.getsangria.com"

    def __init__(
        self,
        api_key: str,
        base_url: str = _DEFAULT_BASE_URL,
        generate_endpoint: str = "/v1/generate-payment",
        settle_endpoint: str = "/v1/settle-payment",
        verify_endpoint: str = "/v1/verify-payment",
        timeout_seconds: float = 8.0,
    ) -> None:
        if not api_key:
            raise ValueError("Sangria: api_key is required")

        self._http = SangriaHTTPClient(
            base_url=base_url,
            api_key=api_key,
            timeout_seconds=timeout_seconds,
        )
        self.generate_endpoint = generate_endpoint
        self.settle_endpoint = settle_endpoint
        self.verify_endpoint = verify_endpoint

    async def handle_fixed_price(
        self,
        payment_header: str | None,
        options: FixedPriceOptions,
    ) -> PaymentResult:
        if not payment_header:
            return await self._generate_payment(options)
        else:
            return await self._settle_payment(payment_header, options)

    # if we dont have a payment header, it means that we need to hit the generate-payment endpoint on our backend,
    # and send the client a 402 response with details on how to pay us
    async def _generate_payment(
        self,
        options: FixedPriceOptions,
    ) -> PaymentResult:
        x402_response_payload = await self._http.post_json(
            self.generate_endpoint,
            options.to_generate_dict(),
            operation="generate",
        )

        # you gotta encode the payload before sending it back (part of the spec)
        encoded = base64.b64encode(json.dumps(x402_response_payload).encode()).decode()

        return PaymentResponse(
            status_code=402,
            body=x402_response_payload,
            headers={"PAYMENT-REQUIRED": encoded},
        )

    # there was a payment header so we try to settle the payment
    async def _settle_payment(
        self,
        payment_header: str,
        options: FixedPriceOptions,
    ) -> PaymentResult:
        result = await self._http.post_json(
            self.settle_endpoint,
            {"payment_payload": payment_header},
            operation="settle",
        )

        if not result.get("success", False):
            return PaymentResponse(
                status_code=402,
                body={
                    "error": result.get("error_message", "Payment failed"),
                    "error_reason": result.get("error_reason"),
                },
            )

        payment_response = base64.b64encode(
            json.dumps({
                "success": True,
                "transaction": result.get("transaction"),
                "network": result.get("network"),
                "payer": result.get("payer"),
            }).encode()
        ).decode()

        return PaymentProceeded(
            paid=True,
            amount=options.price,
            transaction=result.get("transaction"),
            network=result.get("network"),
            payer=result.get("payer"),
            headers={"PAYMENT-RESPONSE": payment_response},
        )

    # ── Upto (variable price) ──────────────────────────────────────────

    async def generate_upto_payment(
        self,
        options: UptoPriceOptions,
    ) -> PaymentResponse:
        x402_response_payload = await self._http.post_json(
            self.generate_endpoint,
            options.to_generate_dict(),
            operation="generate",
        )
        encoded = base64.b64encode(
            json.dumps(x402_response_payload).encode()
        ).decode()
        return PaymentResponse(
            status_code=402,
            body=x402_response_payload,
            headers={"PAYMENT-REQUIRED": encoded},
        )

    async def verify_payment(
        self,
        payment_header: str,
        max_amount_microunits: int,
    ) -> VerifyResult:
        result = await self._http.post_json(
            self.verify_endpoint,
            {
                "payment_payload": payment_header,
                "scheme": "upto",
                "max_amount": max_amount_microunits,
            },
            operation="verify",
        )
        return VerifyResult(
            valid=result.get("valid", False),
            payer=result.get("payer"),
            reason=result.get("reason"),
            message=result.get("message"),
        )

    async def settle_upto_payment(
        self,
        payment_header: str,
        settlement_amount_microunits: int,
    ) -> SettleResult:
        result = await self._http.post_json(
            self.settle_endpoint,
            {
                "payment_payload": payment_header,
                "scheme": "upto",
                "settlement_amount": settlement_amount_microunits,
            },
            operation="settle",
        )
        return SettleResult(
            success=result.get("success", False),
            transaction=result.get("transaction"),
            network=result.get("network"),
            payer=result.get("payer"),
            error_reason=result.get("error_reason"),
            error_message=result.get("error_message"),
        )

    def create_settle_fn(
        self,
        max_price: float,
    ) -> tuple[Callable[[float, Any], Settled], Callable[[], tuple[float, Any] | None]]:
        if isinstance(max_price, bool) or not isinstance(max_price, (int, float)) or not math.isfinite(max_price) or max_price <= 0:
            raise ValueError("Sangria: max_price must be a positive finite number")
        called = False
        result_data: tuple[float, Any] | None = None

        def settle(amount: float, body: Any) -> Settled:
            nonlocal called, result_data
            if isinstance(amount, bool) or not isinstance(amount, (int, float)) or not math.isfinite(amount) or amount <= 0:
                raise ValueError("Sangria: settle amount must be a positive finite number")
            if called:
                raise RuntimeError("Sangria: settle() may only be called once per request")
            if amount > max_price:
                logger.warning(
                    "[sangria-sdk] settle amount $%s exceeds max_price $%s, clamping to max_price",
                    amount, max_price,
                )
                amount = max_price
            called = True
            result_data = (amount, body)
            return Settled(_SETTLE_GUARD, amount, body)

        return settle, lambda: result_data

    async def aclose(self) -> None:
        await self._http.close()
