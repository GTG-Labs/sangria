from __future__ import annotations

from typing import Any

import httpx

from .errors import (
    SangriaAPIStatusError,
    SangriaConnectionError,
    SangriaTimeoutError,
)


def _request_or_none(exc: httpx.RequestError) -> httpx.Request | None:
    try:
        return exc.request
    except RuntimeError:
        return None


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
        *,
        operation: str,
    ) -> dict[str, Any]:
        try:
            response = await self._client.post(endpoint, json=payload)
        except httpx.TimeoutException as exc:
            raise SangriaTimeoutError(
                f"Sangria request timed out: {exc}",
                operation=operation,
                request=_request_or_none(exc),
            ) from exc
        except httpx.RequestError as exc:
            raise SangriaConnectionError(
                f"Sangria connection failed: {exc}",
                operation=operation,
                request=_request_or_none(exc),
            ) from exc

        if not response.is_success:
            message = _parse_error_message(response)
            raise SangriaAPIStatusError(
                message,
                operation=operation,
                response=response,
                status_code=response.status_code,
            )

        try:
            return response.json()
        except Exception as exc:
            raise SangriaAPIStatusError(
                "Sangria returned a malformed response body",
                operation=operation,
                response=response,
                status_code=response.status_code,
            ) from exc

    async def close(self) -> None:
        await self._client.aclose()


def _parse_error_message(response: httpx.Response) -> str:
    """Extract a human-readable error message from a Sangria error response.

    Tries (in order): body.error.message, body.message, response text,
    falls back to HTTP {status}.
    """
    try:
        body = response.json()
    except Exception:
        text = (response.text or "").strip()
        return text or f"HTTP {response.status_code}"

    if isinstance(body, dict):
        error_obj = body.get("error")
        if isinstance(error_obj, dict):
            nested = error_obj.get("message")
            if isinstance(nested, str) and nested:
                return nested
        if isinstance(error_obj, str) and error_obj:
            return error_obj
        top = body.get("message")
        if isinstance(top, str) and top:
            return top

    text = (response.text or "").strip()
    return text or f"HTTP {response.status_code}"
