# Sangria Merchant Python SDK

Merchant-facing SDK that integrates FastAPI endpoints with Sangria backend pre-flight and settlement checks.

## Install (local workspace)

```bash
cd sdk/python
pip install -e .
```

## Quick usage

```python
from fastapi import FastAPI, Request
from sangria_sdk import SangriaMerchantClient
from sangria_sdk.fastapi import require_sangria_payment

app = FastAPI()
client = SangriaMerchantClient(
    base_url="http://localhost:3000",
    api_key="your-sangria-api-key",
)

@app.get("/premium")
@require_sangria_payment(client, amount=0.0001)
async def premium_data(request: Request):
    return {
        "ok": True,
        "verification": getattr(request.state, "sangria_verification", None),
    }
```

## Endpoint contract assumptions

The SDK currently targets these backend endpoints:

- `POST /v1/generate-payment`
- `POST /v1/settle-payment`

### `POST /v1/generate-payment` request

```json
{
  "amount": 0.01,
  "resource": "/premium",
  "scheme": "exact",
  "description": "Premium access"
}
```

### `POST /v1/generate-payment` response

```json
{
  "x402Version": 2,
  "description": "Premium access",
  "resource": "/premium",
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:84532",
      "amount": "10000",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "payTo": "0xabc...",
      "maxTimeoutSeconds": 300,
      "extra": {
        "name": "USDC",
        "version": "1",
        "assetTransferMethod": "eip3009"
      }
    }
  ]
}
```

### `POST /v1/settle-payment` request

```json
{
  "paymentHeader": "<eip712-signed-payload>",
  "resource": "/premium",
  "amount": 0.01,
  "scheme": "exact"
}
```

### `POST /v1/settle-payment` response

```json
{
  "success": true,
  "transaction": "0xdef...",
  "error": null
}
```

`settle_payment` is terminal from the SDK perspective: verification is done on Sangria backend.
