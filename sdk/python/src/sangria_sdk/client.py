from __future__ import annotations

import base64
import json
from typing import Any

from ._http import SangriaHTTPClient
from .errors import SettlementFailedError
from .models import (
    GeneratePaymentRequest,
    GeneratePaymentResponse,
    SettlePaymentRequest,
    SettlementResult,
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

    async def generate_payment(self, req: GeneratePaymentRequest) -> GeneratePaymentResponse:
        challenge = await self._http.post_json(self.generate_endpoint, req.to_dict())
        encoded = base64.b64encode(json.dumps(challenge).encode()).decode()
        return GeneratePaymentResponse(
            status_code=402,
            body=challenge,
            headers={"PAYMENT-REQUIRED": encoded},
        )

    async def settle_payment(self, payment_payload: str) -> SettlementResult:
        req = SettlePaymentRequest(payment_payload=payment_payload)
        data = await self._http.post_json(self.settle_endpoint, req.to_dict())
        result = SettlementResult.from_dict(data)
        if not result.success:
            raise SettlementFailedError(
                message=result.error_message or "Settlement verification failed",
                reason=result.error_reason,
            )
        return result

    async def aclose(self) -> None:
        await self._http.close()
