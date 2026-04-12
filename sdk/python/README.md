# sangria-core

Python SDK for accepting x402 payments. Supports FastAPI.

## Install

```bash
pip install sangria-core
```

## Quick Start

### FastAPI

```python
from fastapi import FastAPI, Request
from sangria_sdk import SangriaMerchantClient
from sangria_sdk.adapters.fastapi import require_sangria_payment

app = FastAPI()
client = SangriaMerchantClient(
    base_url="https://api.sangria.net",
    api_key="sg_live_...",
)

@app.get("/premium")
@require_sangria_payment(client, amount=0.01, description="Premium content")
async def premium(request: Request):
    # request.state.sangria_payment.transaction == "0x..."
    return {"data": "premium content"}
```

## Bypass Payments

Skip payment for certain requests. This is useful if you want to let API key users access your endpoints for free while charging anonymous or agent-based callers via x402:

```python
@app.get("/premium")
@require_sangria_payment(
    client,
    amount=0.01,
    bypass_if=lambda req: req.headers.get("x-api-key") is not None,
)
async def premium(request: Request):
    return {"data": "premium content"}
```

## How It Works

The `@require_sangria_payment` decorator handles the x402 negotiation loop:

1. **First request** (no `PAYMENT-SIGNATURE` header): calls Sangria's `/v1/generate-payment` endpoint, returns `402 Payment Required` with payment terms and a base64-encoded `PAYMENT-REQUIRED` response header.
2. **Retry** (with `PAYMENT-SIGNATURE` header): forwards the signed payload to Sangria's `/v1/settle-payment` endpoint. On success, stores the result in `request.state.sangria_payment` and calls your handler.

## API Contract

### `POST /v1/generate-payment`

Request:
```json
{ "amount": 10000, "resource": "/premium", "description": "Premium content" }
```

Response (402):
```json
{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:84532",
    "amount": "10000",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo": "0xWalletAddress",
    "maxTimeoutSeconds": 60
  }],
  "resource": { "url": "/premium", "description": "Premium content" }
}
```

### `POST /v1/settle-payment`

Request:
```json
{ "payment_payload": "<base64 EIP-712 signed authorization>" }
```

Response:
```json
{ "success": true, "transaction": "0x...", "network": "base-sepolia", "payer": "0x..." }
```

## Requirements

- Python >= 3.10
- FastAPI >= 0.135.1
- httpx >= 0.28.1
