from __future__ import annotations

import httpx


class SangriaError(Exception):
    """Base exception for all Sangria SDK failures.

    Raised when the Sangria payment backend is unreachable, times out, or
    returns a non-2xx status. Business-level payment failures (rejected, bad
    signature, insufficient funds, etc.) are returned as normal PaymentResult
    values and do NOT raise this exception.
    """

    def __init__(
        self,
        message: str,
        *,
        operation: str,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.operation = operation


class SangriaConnectionError(SangriaError):
    """Network or connection failure reaching the Sangria backend (DNS,
    refused, reset, etc.)."""

    def __init__(
        self,
        message: str,
        *,
        operation: str,
        request: httpx.Request | None = None,
    ) -> None:
        super().__init__(message, operation=operation)
        self.request = request


class SangriaTimeoutError(SangriaConnectionError):
    """Client-side timeout reaching the Sangria backend."""

    def __init__(
        self,
        message: str,
        *,
        operation: str,
        request: httpx.Request | None = None,
    ) -> None:
        super().__init__(message, operation=operation, request=request)


class SangriaAPIStatusError(SangriaError):
    """Sangria backend returned a non-2xx response.

    Covers both 4xx (bad API key, validation, rate limit) and 5xx (backend
    broken). 4xx business-level payment failures (402-ish responses that
    come back as 200 with success=false) do NOT raise this — they are
    returned as PaymentResult.
    """

    def __init__(
        self,
        message: str,
        *,
        operation: str,
        response: httpx.Response,
        status_code: int,
    ) -> None:
        super().__init__(message, operation=operation)
        self.response = response
        self.status_code = status_code
