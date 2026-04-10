# End-to-End Payment Test

Tests the full x402 payment flow: client → merchant server → Sangria backend → CDP facilitator → on-chain settlement.

## Architecture

```
client.py (AI agent / buyer)
    → GET /premium on merchant server
    ← 402 + PaymentRequired
    → Signs EIP-712 authorization (x402 SDK)
    → Retries GET /premium with PAYMENT-SIGNATURE header
    ↓
Merchant Server (separate — see merchant-fastapi/, merchant-express/, etc.)
    → Uses Sangria SDK to generate payment requirements
    → Returns 402 to client
    → On retry: reads PAYMENT-SIGNATURE, calls Sangria settle-payment
    → Returns 200 + resource
    ↓
Sangria Backend (Go)
    → generate-payment: picks wallet from pool, returns PaymentRequired
    → settle-payment: extracts payTo + amount from signed payload,
      calls facilitator verify + settle, writes cross-currency ledger:
        DEBIT  Hot Wallet (USDC ASSET)
        CREDIT Conversion Clearing (USDC)
        DEBIT  Conversion Clearing (USD)
        CREDIT Merchant Payable (USD LIABILITY) — minus platform fee
        CREDIT Platform Fee Revenue (USD)
    ↓
CDP Facilitator (Coinbase)
    → Verifies EIP-712 signature, balance, nonce
    → Submits transferWithAuthorization (EIP-3009) on-chain
    → USDC moves from buyer to Sangria's hot wallet
```

## Prerequisites

1. **Sangria backend** running (`cd backend && go run .`)
2. **A merchant server** running (see below)
3. **CDP credentials** in `playground/.env`:
   ```
   CDP_API_KEY=<your key ID>
   CDP_SECRET_KEY=<your key secret>
   CDP_WALLET_SECRET=<your wallet secret>
   ```
4. **Buyer wallet** funded with USDC + ETH on base

## Usage

### 1. Start a merchant server

Pick one of the merchant server implementations:

```bash
# FastAPI (Python)
cd playground/merchant-fastapi
SANGRIA_URL=http://localhost:8080 SANGRIA_SECRET_KEY="sg_test_xxx" uv run python src/main.py

# Express (Node.js)
cd playground/merchant-express && SANGRIA_SECRET_KEY="sg_test_xxx" bun dev

# Fastify (Node.js)
cd playground/merchant-fastify && SANGRIA_SECRET_KEY="sg_test_xxx" bun dev

# Hono (Node.js)
cd playground/merchant-hono && SANGRIA_SECRET_KEY="sg_test_xxx" bun dev
```

### 2. Run the test client

```bash
cd playground
MERCHANT_URL=http://localhost:4004 uv run python -m e2e_test.client --buyer-address 0x...
```

Set `MERCHANT_URL` to wherever your merchant server is running.

### Creating a buyer wallet

If you don't have a buyer wallet yet:

```python
import asyncio
from wallet import TestnetWallet

async def setup():
    wallet = await TestnetWallet.mint()
    await wallet.fund_eth()    # gas fees
    await wallet.fund_usdc()   # payment token
    print(f"Address: {wallet.address}")

asyncio.run(setup())
```

## What Success Looks Like

```
=== Step 1: GET http://localhost:4004/premium ===
Status: 402

=== Step 2: Sign Payment ===
Payment signed by: 0x...

=== Step 3: Retry with payment ===
Final status: 200
{
  "message": "Welcome to premium content!",
  "paid": true,
  "settlement": {
    "transaction": "0xabc...",
    "payer": "0x...",
    "network": "base"
  }
}

=== Payment successful! ===
```

After settlement, the merchant's USD balance increases (minus platform fee). Check via:

```bash
curl http://localhost:8080/merchant/balance -H "X-API-Key: sg_test_xxx"
```
