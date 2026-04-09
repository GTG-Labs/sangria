from __future__ import annotations

from typing import Any

import httpx


class SangriaHTTPClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout_seconds: float = 8.0,
    ) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=timeout_seconds,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )

    async def post_json(
        self,
        endpoint: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        response = await self._client.post(endpoint, json=payload)
        # only raise on 5xx — 4xx responses carry business-level error payloads
        # that the client needs to inspect (e.g. error_reason, error_message)
        if response.status_code >= 500:
            response.raise_for_status()
        result = response.json()
        if not isinstance(result, dict):
            raise TypeError(f"Expected dict response, got {type(result)}")
        return result

    async def close(self) -> None:
        await self._client.aclose()
