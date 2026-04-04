from __future__ import annotations

from collections.abc import Awaitable, Callable
from decimal import Decimal
from functools import wraps
from typing import Any

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from ..client import SangriaMerchantClient
from ..errors import APIError, SettlementFailedError
from ..models import GeneratePaymentRequest


# ── Entry point: decorate a FastAPI route to require payment ──
#
#   @require_sangria_payment(client, amount=Decimal("0.01"))
#   async def premium(request: Request): ...
#
def require_sangria_payment(
    merchant_client: SangriaMerchantClient,
    amount: Decimal,
    description: str | None = None,
    bypass_if: Callable[[Request], bool] | None = None,
) -> Callable[[Callable[..., Awaitable[Any]]], Callable[..., Awaitable[Any]]]:
    def decorator(func: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            request: Request | None = kwargs.get("request")
            if request is None:
                for arg in args:
                    if isinstance(arg, Request):
                        request = arg
                        break

            if request is None:
                raise HTTPException(status_code=500, detail="FastAPI request not available")

            if bypass_if and bypass_if(request):
                return await func(*args, **kwargs)

            resource = request.url.path
            normalized_amount = amount if isinstance(amount, Decimal) else Decimal(str(amount))
            payment_signature = request.headers.get("PAYMENT-SIGNATURE")

            if not payment_signature:
                try:
                    response = await merchant_client.generate_payment(
                        GeneratePaymentRequest(
                            amount=normalized_amount,
                            resource=resource,
                            description=description,
                        )
                    )
                except APIError as exc:
                    return build_error_response(exc)
                return JSONResponse(
                    status_code=response.status_code,
                    content=response.body,
                    headers=response.headers,
                )
            else:
                try:
                    verification = await merchant_client.settle_payment(
                        payment_payload=payment_signature,
                    )
                except (SettlementFailedError, APIError) as exc:
                    return build_error_response(exc)
                request.state.sangria_verification = verification
                return await func(*args, **kwargs)

        return wrapper

    return decorator


# ── Helpers ──


def build_error_response(exc: Exception) -> JSONResponse:
    if isinstance(exc, SettlementFailedError):
        return JSONResponse(
            status_code=403,
            content={"detail": exc.reason or "Payment verification failed"},
        )
    if isinstance(exc, APIError):
        status_code = 502 if exc.status_code is None else exc.status_code
        payload = exc.payload or {"error": str(exc)}
        return JSONResponse(status_code=status_code, content=payload)
    return JSONResponse(status_code=500, content={"detail": "Unexpected Sangria SDK error"})


def map_sangria_error(exc: Exception) -> HTTPException:
    if isinstance(exc, SettlementFailedError):
        return HTTPException(status_code=403, detail=exc.reason or "Payment verification failed")
    if isinstance(exc, APIError):
        status_code = 502 if exc.status_code is None else exc.status_code
        return HTTPException(status_code=status_code, detail=exc.payload or str(exc))
    return HTTPException(status_code=500, detail="Unexpected Sangria SDK error")
