from __future__ import annotations

import time

from ._http import SangriaHTTPClient
from .errors import SangriaSDKError, SettlementFailedError
from .models import (
    ChallengeConfig,
    GeneratePaymentRequest,
    SettlePaymentRequest,
    SettlementResult,
)

_CACHE_TTL = 60.0  # seconds, matches backend maxTimeoutSeconds
_CACHE_MAX_SIZE = 1000


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
        # resource -> (payment_id, expires_at)
        self._payment_cache: dict[str, tuple[str, float]] = {}

    def _get_cached_payment_id(self, resource: str) -> str | None:
        entry = self._payment_cache.get(resource)
        if entry is None:
            return None
        payment_id, expires_at = entry
        if time.monotonic() > expires_at:
            del self._payment_cache[resource]
            return None
        return payment_id

    def _set_cached_payment_id(self, resource: str, payment_id: str) -> None:
        # Lazy cleanup when cache grows too large
        if len(self._payment_cache) > _CACHE_MAX_SIZE:
            now = time.monotonic()
            expired = [k for k, (_, exp) in self._payment_cache.items() if now > exp]
            for k in expired:
                del self._payment_cache[k]
        self._payment_cache[resource] = (payment_id, time.monotonic() + _CACHE_TTL)

    def _clear_cached_payment_id(self, resource: str) -> None:
        self._payment_cache.pop(resource, None)

    async def generate_payment(self, req: GeneratePaymentRequest) -> ChallengeConfig:
        data = await self._http.post_json(self.generate_endpoint, req.to_dict())
        challenge = ChallengeConfig.from_dict(data)
        if challenge.payment_id:
            self._set_cached_payment_id(req.resource, challenge.payment_id)
        return challenge

    async def settle_payment(self, payment_payload: str) -> SettlementResult:
        req = SettlePaymentRequest(payment_payload=payment_payload)
        data = await self._http.post_json(self.settle_endpoint, req.to_dict())
        result = SettlementResult.from_dict(data)
        if not result.success:
            raise SettlementFailedError(
                message=result.error_message or "Settlement verification failed",
                reason=result.error_reason,
            )
        self._clear_cached_payment_id(resource)
        return result

    async def aclose(self) -> None:
        await self._http.close()
