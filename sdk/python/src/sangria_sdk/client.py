from __future__ import annotations

import base64
import json
from typing import Any

from ._http import SangriaHTTPClient
from .models import (
    FixedPriceOptions,
    PaymentProceeded,
    PaymentResponse,
    PaymentResult,
)


class SangriaMerchantClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        generate_endpoint: str = "/v1/generate-payment",
        settle_endpoint: str = "/v1/settle-payment",
        timeout_seconds: float = 8.0,
    ) -> None:
        self._http = SangriaHTTPClient(
            base_url=base_url,
            api_key=api_key,
            timeout_seconds=timeout_seconds,
        )
        self.generate_endpoint = generate_endpoint
        self.settle_endpoint = settle_endpoint

    async def handle_fixed_price(
        self,
        payment_header: str | None,
        options: FixedPriceOptions,
    ) -> PaymentResult:
        if not payment_header:
            try:
                challenge = await self._http.post_json(
                    self.generate_endpoint,
                    options.to_generate_dict(),
                )
                encoded = base64.b64encode(json.dumps(challenge).encode()).decode()
                return PaymentResponse(
                    action="respond",
                    status_code=402,
                    body=challenge,
                    headers={"PAYMENT-REQUIRED": encoded},
                )
            except Exception:
                return PaymentResponse(
                    action="respond",
                    status_code=500,
                    body={"error": "Payment service unavailable"},
                )
        else:
            try:
                data = await self._http.post_json(
                    self.settle_endpoint,
                    {"payment_payload": payment_header},
                )
                success = data.get("success", False)
                if not success:
                    return PaymentResponse(
                        action="respond",
                        status_code=402,
                        body={
                            "error": data.get("error_message", "Payment failed"),
                            "error_reason": data.get("error_reason"),
                        },
                    )
                return PaymentProceeded(
                    action="proceed",
                    paid=True,
                    amount=options.price,
                    transaction=data.get("transaction"),
                )
            except Exception:
                return PaymentResponse(
                    action="respond",
                    status_code=500,
                    body={"error": "Payment settlement failed"},
                )

    async def aclose(self) -> None:
        await self._http.close()
