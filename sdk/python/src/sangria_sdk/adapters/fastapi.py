from __future__ import annotations

from collections.abc import Awaitable, Callable
from functools import wraps
from typing import Any

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from ..client import SangriaMerchantClient, validate_fixed_price_options
from ..models import FixedPriceOptions, PaymentResponse


# ── Entry point: decorate a FastAPI route to require payment ──
#
#   @require_sangria_payment(client, amount=0.01)
#   async def premium(request: Request): ...
#
def require_sangria_payment(
    merchant_client: SangriaMerchantClient,
    amount: float,
    description: str | None = None,
    bypass_if: Callable[[Request], bool] | None = None,
) -> Callable[[Callable[..., Awaitable[Any]]], Callable[..., Awaitable[Any]]]:
    # Validate at decorator construction time so misconfigured prices fail at
    # app startup instead of on the first paying request.
    validate_fixed_price_options(
        FixedPriceOptions(price=amount, resource="", description=description)
    )

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

            result = await merchant_client.handle_fixed_price(
                payment_header=request.headers.get("PAYMENT-SIGNATURE"),
                options=FixedPriceOptions(
                    price=amount,
                    resource=str(request.url),
                    description=description,
                ),
            )

            if isinstance(result, PaymentResponse):
                return JSONResponse(
                    status_code=result.status_code,
                    content=result.body,
                    headers=result.headers,
                )

            request.state.sangria_payment = result
            return await func(*args, **kwargs)

        return wrapper

    return decorator
