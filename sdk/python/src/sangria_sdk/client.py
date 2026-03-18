from __future__ import annotations

from ._http import SangriaHTTPClient
from .errors import SettlementFailedError
from .models import (
    ChallengeConfig,
    GeneratePaymentRequest,
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

    async def generate_payment(self, req: GeneratePaymentRequest) -> ChallengeConfig:
        data = await self._http.post_json(self.generate_endpoint, req.to_dict())
        return ChallengeConfig.from_dict(data)

    async def settle_payment(self, req: SettlePaymentRequest) -> SettlementResult:
        data = await self._http.post_json(
            self.settle_endpoint,
            req.to_dict(),
            idempotency_key=req.idempotency_key,
        )
        result = SettlementResult.from_dict(data)
        if not result.success:
            raise SettlementFailedError(
                message="Settlement verification failed",
                reason=result.error,
            )
        return result

    async def aclose(self) -> None:
        await self._http.close()
