from __future__ import annotations

import base64
import inspect
import json
import logging
from collections.abc import Awaitable, Callable
from functools import wraps
from typing import Any

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.responses import Response

from ..client import SangriaMerchantClient, validate_fixed_price_options
from ..errors import SangriaHandlerException
from ..models import (
    FixedPriceOptions,
    PaymentProceeded,
    PaymentResponse,
    SangriaTransaction,
    Settled,
    UptoPriceOptions,
    to_microunits,
)

logger = logging.getLogger("sangria_sdk")


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

            should_bypass = False
            if bypass_if is not None:
                try:
                    should_bypass = bypass_if(request)
                except Exception:
                    # Fail closed: if the merchant's bypass_if callback raises,
                    # enforce payment rather than risk letting the request
                    # through for free.
                    logger.exception(
                        "[sangria-sdk] bypass_if raised; falling through to payment required"
                    )
                    should_bypass = False
            if should_bypass:
                try:
                    return await func(*args, **kwargs)
                except SangriaHandlerException as exc:
                    return JSONResponse(status_code=exc.status_code, content=exc.body)

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
            try:
                response = await func(*args, **kwargs)
            except SangriaHandlerException as exc:
                return JSONResponse(status_code=exc.status_code, content=exc.body)

            # Attach x402 PAYMENT-RESPONSE header to the handler's response
            if result.headers and isinstance(response, Response):
                for k, v in result.headers.items():
                    response.headers[k] = v

            return response

        return wrapper

    return decorator


# ── Upto (variable price): decorate a FastAPI route to require payment ──
#
#   @require_upto_price(client, max_price=0.10)
#   async def search(request: Request, settle):
#       results = do_search(request.query_params["q"])
#       return settle(len(results) * 0.002, {"results": results})
#
def require_upto_price(
    merchant_client: SangriaMerchantClient,
    max_price: float,
    description: str | None = None,
    bypass_if: Callable[[Request], bool] | None = None,
) -> Callable[[Callable[..., Awaitable[Any]]], Callable[..., Awaitable[Any]]]:
    UptoPriceOptions(max_price=max_price, resource="", description=description)

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

            should_bypass = False
            if bypass_if is not None:
                try:
                    should_bypass = bypass_if(request)
                except Exception:
                    logger.exception(
                        "[sangria-sdk] bypass_if raised; falling through to payment required"
                    )
                    should_bypass = False

            if should_bypass:
                request.state.sangria_payment = PaymentProceeded(paid=False, amount=0)
                settle_fn, get_result = merchant_client.create_settle_fn(max_price)
                kwargs["settle"] = settle_fn
                try:
                    result = await func(*args, **kwargs)
                except SangriaHandlerException as exc:
                    return JSONResponse(status_code=exc.status_code, content=exc.body)
                if not isinstance(result, Settled):
                    raise TypeError("Sangria: handler must return settle(amount, body)")
                settle_data = get_result()
                return JSONResponse(content=settle_data[1] if settle_data else None)

            payment_header = request.headers.get("PAYMENT-SIGNATURE")

            if not payment_header:
                upto_options = UptoPriceOptions(
                    max_price=max_price,
                    resource=str(request.url),
                    description=description,
                )
                payment_response = await merchant_client.generate_upto_payment(upto_options)
                return JSONResponse(
                    status_code=payment_response.status_code,
                    content=payment_response.body,
                    headers=payment_response.headers,
                )

            verify_result = await merchant_client.verify_payment(
                payment_header,
                to_microunits(max_price),
            )
            if not verify_result.valid:
                return JSONResponse(
                    status_code=402,
                    content={
                        "error": verify_result.message or "Payment verification failed",
                        "error_reason": verify_result.reason,
                    },
                )

            settle_fn, get_result = merchant_client.create_settle_fn(max_price)
            kwargs["settle"] = settle_fn

            try:
                result = await func(*args, **kwargs)
            except SangriaHandlerException as exc:
                return JSONResponse(status_code=exc.status_code, content=exc.body)

            if not isinstance(result, Settled):
                raise TypeError("Sangria: handler must return settle(amount, body)")

            settle_data = get_result()
            if settle_data is None:
                raise RuntimeError("Sangria: handler returned without calling settle()")

            amount, body = settle_data

            settle_result = await merchant_client.settle_upto_payment(
                payment_header,
                to_microunits(amount),
            )

            if not settle_result.success:
                return JSONResponse(
                    status_code=402,
                    content={
                        "error": settle_result.error_message or "Payment settlement failed",
                        "error_reason": settle_result.error_reason,
                    },
                )

            payment_response_header = base64.b64encode(
                json.dumps({
                    "success": True,
                    "transaction": settle_result.transaction,
                    "network": settle_result.network,
                    "payer": settle_result.payer,
                }).encode()
            ).decode()

            request.state.sangria_payment = PaymentProceeded(
                paid=True,
                amount=amount,
                transaction=settle_result.transaction,
                network=settle_result.network,
                payer=settle_result.payer,
            )

            response = JSONResponse(content=body)
            response.headers["PAYMENT-RESPONSE"] = payment_response_header
            return response

        # Strip 'settle' from the exposed signature so FastAPI's DI ignores it
        sig = inspect.signature(func)
        wrapper.__signature__ = sig.replace(  # type: ignore[attr-defined]
            parameters=[p for p in sig.parameters.values() if p.name != "settle"]
        )
        return wrapper

    return decorator


# ── Computed price: dynamic exact pricing based on request ──
#
#   @app.post("/buy")
#   @computed_price(sangria, calc_price)
#   async def buy(request: Request, transaction: SangriaTransaction):
#       return {"success": True, "transaction_id": transaction.hash}
#
#   calc_price is called on every request (both the initial 402 and the paid
#   retry). The second call is what detects body tampering — if an attacker
#   replays a signature with a modified body, the recomputed price won't match
#   the signed amount and the request is rejected before settlement.
#
#   bypass_if is intentionally not supported here. The existing bypass
#   implementation in fixed_price/upto_price is being reworked; adding a known-
#   faulty variant to a new API surface would just create more migration work.
#
def computed_price(
    merchant_client: SangriaMerchantClient,
    calc_price: Callable[..., Any],
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

            if inspect.iscoroutinefunction(calc_price):
                price = await calc_price(request)
            else:
                price = calc_price(request)

            result = await merchant_client.handle_fixed_price(
                payment_header=request.headers.get("PAYMENT-SIGNATURE"),
                options=FixedPriceOptions(
                    price=price,
                    resource=str(request.url),
                ),
            )

            if isinstance(result, PaymentResponse):
                return JSONResponse(
                    status_code=result.status_code,
                    content=result.body,
                    headers=result.headers,
                )

            if to_microunits(result.amount) != to_microunits(price):
                return JSONResponse(
                    status_code=409,
                    content={"error": "Price mismatch: settled amount differs from computed price"},
                )

            transaction = SangriaTransaction(
                hash=result.transaction or "",
                network=result.network or "",
                payer=result.payer or "",
                amount=result.amount,
            )

            request.state.sangria_payment = result
            kwargs["transaction"] = transaction
            response = await func(*args, **kwargs)

            if result.headers and isinstance(response, Response):
                for k, v in result.headers.items():
                    response.headers[k] = v

            return response

        sig = inspect.signature(func)
        wrapper.__signature__ = sig.replace(  # type: ignore[attr-defined]
            parameters=[p for p in sig.parameters.values() if p.name != "transaction"]
        )
        return wrapper

    return decorator
