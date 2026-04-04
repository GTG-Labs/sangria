import base64
import hashlib
import json
import os
import random
import time

from dotenv import load_dotenv

load_dotenv()

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi_x402 import init_x402, pay, get_facilitator_client
from fastapi_x402.models import PaymentRequirements
from fastapi_x402.networks import get_default_asset_config

MERCHANT_ADDRESS = "0xF44cc4b82470Eb3D1fDAc83b8b7226d7cD07fd39"
NETWORK = "base-sepolia"

# Variable pricing bounds (in dollars)
VARIABLE_MIN_PRICE = 0.0001
VARIABLE_MAX_PRICE = 0.0005

# TinyFish config
TINYFISH_API_URL = os.getenv("TINYFISH_API_URL", "https://agent.tinyfish.ai")
TINYFISH_API_KEY = os.getenv("TINYFISH_API_KEY", "")
COST_PER_STEP_USD = 0.015
_tinyfish_cache: dict = {}  # body_hash -> {result, price_atomic, price_usd, expires_at}
CACHE_TTL_SECONDS = 300

app = FastAPI(title="x402 Payment Demo")

init_x402(app, pay_to=MERCHANT_ADDRESS, network=NETWORK)


def _payment_required_response(content: dict) -> JSONResponse:
    encoded = base64.b64encode(json.dumps(content).encode()).decode()
    return JSONResponse(status_code=402, content=content, headers={"PAYMENT-REQUIRED": encoded})


def _payment_response_headers(transaction: str) -> dict:
    payload = json.dumps({"transaction": transaction}) if transaction else ""
    return {"PAYMENT-RESPONSE": payload} if payload else {}


def _compute_body_hash(body: dict) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


def _cleanup_expired_cache():
    now = time.time()
    expired = [k for k, v in _tinyfish_cache.items() if v["expires_at"] < now]
    for k in expired:
        del _tinyfish_cache[k]


@app.get("/")
def health():
    return {"status": "ok"}


@pay("$0.0001")
@app.get("/premium")
def premium():
    return {"message": "You accessed the premium endpoint!", "paid": True}


@app.get("/variable")
async def variable(request: Request):
    asset_config = get_default_asset_config(NETWORK)
    payment_header = request.headers.get("PAYMENT-SIGNATURE")

    if not payment_header:
        actual_cost = round(random.uniform(VARIABLE_MIN_PRICE, VARIABLE_MAX_PRICE), 6)
        resource = f"{request.url.scheme}://{request.url.netloc}{request.url.path}"
        return _payment_required_response(
            {
                "x402Version": 2,
                "error": "PAYMENT-SIGNATURE header is required",
                "accepts": [
                    {
                        "scheme": "exact",
                        "network": NETWORK,
                        "amount": str(int(actual_cost * 10 ** asset_config.decimals)),
                        "resource": resource,
                        "description": f"Variable-priced endpoint (cost: ${actual_cost})",
                        "mimeType": "application/json",
                        "payTo": MERCHANT_ADDRESS,
                        "maxTimeoutSeconds": 300,
                        "asset": asset_config.address,
                        "extra": {
                            "name": asset_config.eip712_name,
                            "version": asset_config.eip712_version,
                        },
                    }
                ],
            }
        )

    facilitator = get_facilitator_client()

    try:
        payment_data = json.loads(base64.b64decode(payment_header))
        signed_amount = payment_data.get("payload", {}).get("authorization", {}).get("value")
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid payment header"})

    resource = f"{request.url.scheme}://{request.url.netloc}{request.url.path}"
    verify_requirements = PaymentRequirements(
        scheme="exact",
        network=NETWORK,
        maxAmountRequired=str(signed_amount),
        resource=resource,
        description="",
        mimeType="application/json",
        payTo=MERCHANT_ADDRESS,
        maxTimeoutSeconds=300,
        asset=asset_config.address,
        extra={
            "name": asset_config.eip712_name,
            "version": asset_config.eip712_version,
        },
    )

    verify_result = await facilitator.verify_payment(payment_header, verify_requirements)
    if not verify_result.isValid:
        return JSONResponse(status_code=402, content={"error": verify_result.error})

    actual_cost_usd = int(signed_amount) / (10 ** asset_config.decimals)

    settle_result = await facilitator.settle_payment(payment_header, verify_requirements)
    if not settle_result.success:
        return JSONResponse(status_code=500, content={"error": settle_result.errorReason or "Settlement failed"})

    return JSONResponse(
        content={
            "message": f"Work done! Actual cost: ${actual_cost_usd}",
            "paid": True,
            "actual_cost_usd": actual_cost_usd,
            "transaction": settle_result.transaction or "",
        },
        headers=_payment_response_headers(settle_result.transaction or ""),
    )


@app.post("/run")
async def run_automation(request: Request):
    asset_config = get_default_asset_config(NETWORK)
    payment_header = request.headers.get("PAYMENT-SIGNATURE")
    body = await request.json()
    body_hash = _compute_body_hash(body)

    _cleanup_expired_cache()

    # Phase 1: No payment header — run TinyFish, cache result, return 402
    if not payment_header:
        # Check cache first (avoid re-running TinyFish)
        if body_hash not in _tinyfish_cache:
            if not TINYFISH_API_KEY:
                return JSONResponse(status_code=500, content={"error": "TINYFISH_API_KEY not configured"})

            async with httpx.AsyncClient(timeout=httpx.Timeout(660.0)) as client:
                try:
                    tf_response = await client.post(
                        f"{TINYFISH_API_URL}/v1/automation/run",
                        json=body,
                        headers={"X-API-Key": TINYFISH_API_KEY},
                    )
                except httpx.TimeoutException:
                    return JSONResponse(status_code=504, content={"error": "TinyFish request timed out"})

            if tf_response.status_code != 200:
                return JSONResponse(
                    status_code=502,
                    content={"error": f"TinyFish error {tf_response.status_code}", "details": tf_response.text},
                )

            tf_result = tf_response.json()
            num_of_steps = tf_result.get("num_of_steps", 0)

            # Free if zero steps
            if num_of_steps == 0:
                return tf_result

            price_usd = num_of_steps * COST_PER_STEP_USD
            price_atomic = int(price_usd * 10 ** asset_config.decimals)

            _tinyfish_cache[body_hash] = {
                "result": tf_result,
                "price_atomic": price_atomic,
                "price_usd": price_usd,
                "expires_at": time.time() + CACHE_TTL_SECONDS,
            }

        cached = _tinyfish_cache[body_hash]
        resource = f"{request.url.scheme}://{request.url.netloc}{request.url.path}"
        return _payment_required_response(
            {
                "x402Version": 2,
                "error": "PAYMENT-SIGNATURE header is required",
                "accepts": [
                    {
                        "scheme": "exact",
                        "network": NETWORK,
                        "amount": str(cached["price_atomic"]),
                        "resource": resource,
                        "description": f"TinyFish automation ({cached['price_usd']:.4f} USD)",
                        "mimeType": "application/json",
                        "payTo": MERCHANT_ADDRESS,
                        "maxTimeoutSeconds": 300,
                        "asset": asset_config.address,
                        "extra": {
                            "name": asset_config.eip712_name,
                            "version": asset_config.eip712_version,
                        },
                    }
                ],
            }
        )

    # Phase 2: Has payment header — look up cache, verify, settle, return result
    if body_hash not in _tinyfish_cache:
        return JSONResponse(status_code=400, content={"error": "No cached result for this request. Try again without payment."})

    cached = _tinyfish_cache[body_hash]

    try:
        payment_data = json.loads(base64.b64decode(payment_header))
        signed_amount = payment_data.get("payload", {}).get("authorization", {}).get("value")
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid payment header"})

    resource = f"{request.url.scheme}://{request.url.netloc}{request.url.path}"
    verify_requirements = PaymentRequirements(
        scheme="exact",
        network=NETWORK,
        maxAmountRequired=str(signed_amount),
        resource=resource,
        description="",
        mimeType="application/json",
        payTo=MERCHANT_ADDRESS,
        maxTimeoutSeconds=300,
        asset=asset_config.address,
        extra={
            "name": asset_config.eip712_name,
            "version": asset_config.eip712_version,
        },
    )

    facilitator = get_facilitator_client()

    verify_result = await facilitator.verify_payment(payment_header, verify_requirements)
    if not verify_result.isValid:
        return JSONResponse(status_code=402, content={"error": verify_result.error})

    print(f"[/run] About to settle. signed_amount={signed_amount}, cached price_atomic={cached['price_atomic']}")
    settle_result = await facilitator.settle_payment(payment_header, verify_requirements)
    print(f"[/run] settle_result: success={settle_result.success}, transaction={settle_result.transaction}, errorReason={settle_result.errorReason}")
    if not settle_result.success:
        return JSONResponse(status_code=500, content={"error": settle_result.errorReason or "Settlement failed"})

    result = cached["result"]
    price_usd = cached["price_usd"]
    del _tinyfish_cache[body_hash]

    return JSONResponse(
        content={
            **result,
            "payment": {
                "cost_usd": price_usd,
                "transaction": settle_result.transaction or "",
            },
        },
        headers=_payment_response_headers(settle_result.transaction or ""),
    )
