from __future__ import annotations

from typing import Any

import httpx

from .errors import APIError


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
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        headers: dict[str, str] = {}
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key

        try:
            response = await self._client.post(endpoint, json=payload, headers=headers)
        except httpx.RequestError as exc:
            raise APIError(
                message=f"Sangria transport error: {exc}",
                status_code=None,
                payload={"error": str(exc)},
            ) from exc

        if response.status_code >= 400:
            body: dict[str, Any]
            try:
                body = response.json()
            except ValueError:
                body = {"error": response.text}
            raise APIError(
                message=f"Sangria backend error ({response.status_code})",
                status_code=response.status_code,
                payload=body,
            )

        try:
            return response.json()
        except ValueError as exc:
            raise APIError("Sangria backend returned non-JSON response") from exc

    async def close(self) -> None:
        await self._client.aclose()
