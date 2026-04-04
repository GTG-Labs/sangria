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
    → generate-payment: picks LRU wallet, returns PaymentRequired
    → settle-payment: calls CDP facilitator verify + settle
    → Writes double-entry ledger (DEBIT hot wallet, CREDIT merchant)
    ↓
CDP Facilitator (Coinbase)
    → Verifies EIP-712 signature, balance, nonce
    → Submits transferWithAuthorization (EIP-3009) on-chain
    → USDC moves from buyer to Sangria's hot wallet
```

## Prerequisites

1. **Sangria backend** running
2. **A merchant server** running (see `playground/merchant-fastapi/`, `merchant-express/`, `merchant-fastify/`, or `merchant-hono/`)
3. **CDP credentials** in `playground/.env`:
   ```
   CDP_API_KEY=<your key ID>
   CDP_SECRET_KEY=<your key secret>
   CDP_WALLET_SECRET=<your wallet secret>
   ```
4. **Buyer wallet** funded with USDC + ETH on the target network

## Files

| File | Purpose |
|------|---------|
| `client.py` | Test buyer client — hits a merchant server endpoint, x402 SDK handles the 402 payment flow automatically |

## Usage

### 1. Start a merchant server

Pick one of the merchant server implementations:

```bash
# FastAPI
cd playground/merchant-fastapi && MERCHANT_API_KEY="sg_test_xxx" uv run uvicorn app:app --port 9000

# Express
cd playground/merchant-express && MERCHANT_API_KEY="sg_test_xxx" npm start

# Fastify
cd playground/merchant-fastify && MERCHANT_API_KEY="sg_test_xxx" npm start

# Hono
cd playground/merchant-hono && MERCHANT_API_KEY="sg_test_xxx" npm start
```

### 2. Run the test client

```bash
cd playground
uv run python -m e2e_test.client --buyer-address 0x...
```

Update the `MERCHANT_URL` in `client.py` to point to your merchant server.

### Testnet vs Mainnet

- **Testnet** (`base-sepolia`): Create buyer wallet with free faucet funds.
- **Mainnet** (`base`): Fund buyer wallet with real USDC + ETH from Coinbase or another wallet.

## What Success Looks Like

```
=== Step 1: GET https://your-merchant.com/premium ===
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
    "network": "eip155:8453"
  }
}

=== Payment successful! ===
```
