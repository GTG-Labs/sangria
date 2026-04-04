from __future__ import annotations

from collections.abc import Awaitable, Callable
import base64
import json
from decimal import Decimal
from functools import wraps
from typing import Any

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from .client import SangriaMerchantClient
from .errors import APIError, SettlementFailedError
from .models import GeneratePaymentRequest


def build_402_response(challenge: dict[str, Any]) -> JSONResponse:
    encoded = base64.b64encode(json.dumps(challenge).encode()).decode()
    return JSONResponse(
        status_code=402,
        content=challenge,
        headers={"PAYMENT-REQUIRED": encoded},
    )


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


def require_sangria_payment(
    merchant_client: SangriaMerchantClient,
    amount: Decimal,
    description: str | None = None,
    resource_resolver: Callable[[Request], str] | None = None,
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

            resource = resource_resolver(request) if resource_resolver else request.url.path
            normalized_amount = amount if isinstance(amount, Decimal) else Decimal(str(amount))
            payment_signature = request.headers.get("PAYMENT-SIGNATURE")

            if not payment_signature:
                try:
                    challenge = await merchant_client.generate_payment(
                        GeneratePaymentRequest(
                            amount=normalized_amount,
                            resource=resource,
                            description=description,
                        )
                    )
                except APIError as exc:
                    return build_error_response(exc)
                return build_402_response(challenge.to_dict())

            try:
                verification = await merchant_client.settle_payment(
                    payment_payload=payment_signature,
                )
            except (SettlementFailedError, APIError) as exc:
                return build_error_response(exc)
            except SangriaSDKError:
                # Cache miss (server restart, TTL expiry) — re-generate challenge
                try:
                    challenge = await merchant_client.generate_payment(
                        GeneratePaymentRequest(
                            amount=normalized_amount,
                            resource=resource,
                            description=description,
                        )
                    )
                except APIError as exc:
                    return build_error_response(exc)
                return build_402_response(challenge.to_dict())
            request.state.sangria_verification = verification
            return await func(*args, **kwargs)

        return wrapper

    return decorator


def map_sangria_error(exc: Exception) -> HTTPException:
    if isinstance(exc, SettlementFailedError):
        return HTTPException(status_code=403, detail=exc.reason or "Payment verification failed")
    if isinstance(exc, APIError):
        status_code = 502 if exc.status_code is None else exc.status_code
        return HTTPException(status_code=status_code, detail=exc.payload or str(exc))
    return HTTPException(status_code=500, detail="Unexpected Sangria SDK error")
