# Sangria Playground

Test implementations for the [x402 payment protocol](https://www.x402.org/) integrated with the Sangria backend. Includes merchant servers in multiple frameworks and a test client for end-to-end payment testing.

## How it works

```
Buyer (e2e_test/client.py)           Merchant Server (:<port>)             Sangria Backend (:8080)
       |                                     |                                    |
       |  GET /premium                       |                                    |
       |------------------------------------>|                                    |
       |                                     |  POST /v1/generate-payment         |
       |                                     |----------------------------------->|
       |                                     |  ← PaymentRequired                 |
       |                                     |<-----------------------------------|
       |  402 + PaymentRequired              |                                    |
       |<------------------------------------|                                    |
       |                                     |                                    |
       |  x402 SDK signs EIP-712             |                                    |
       |                                     |                                    |
       |  GET /premium + PAYMENT-SIGNATURE   |                                    |
       |------------------------------------>|                                    |
       |                                     |  POST /v1/settle-payment            |
       |                                     |----------------------------------->|
       |                                     |  ← settlement result               |
       |                                     |<-----------------------------------|
       |  200 OK { "paid": true }            |                                    |
       |<------------------------------------|                                    |
```

## Project structure

```
playground/
├── e2e_test/
│   ├── client.py              # Test buyer — step-by-step x402 payment flow
│   └── README.md              # Full e2e test instructions
├── merchant-fastapi/          # Merchant server using Sangria Python SDK + FastAPI
├── merchant-express/          # Merchant server using Sangria JS SDK + Express
├── merchant-fastify/          # Merchant server using Sangria JS SDK + Fastify
├── merchant-hono/             # Merchant server using Sangria JS SDK + Hono
├── wallet/
│   └── wallet.py              # TestnetWallet — create, fund, and check CDP wallets
├── merchant_server/           # (Legacy) Standalone demo without Sangria backend
└── main.py                    # (Legacy) Standalone buyer client
```

## Quick start

### Prerequisites

- Sangria backend running on `localhost:8080` (see `backend/README.md`)
- A merchant API key (create via `POST /merchants` on the backend)
- CDP credentials in `playground/.env`:
  ```
  CDP_API_KEY=<your key ID>
  CDP_SECRET_KEY=<your key secret>
  CDP_WALLET_SECRET=<your wallet secret>
  ```
- A buyer wallet funded with testnet USDC + ETH (see below)
- [uv](https://docs.astral.sh/uv/) for Python, or npm for Node.js servers

### 1. Install dependencies

```bash
cd playground
uv sync
```

### 2. Create and fund a buyer wallet (one-time)

```bash
uv run python -c "
import asyncio
from wallet import TestnetWallet
async def setup():
    w = await TestnetWallet.mint()
    await w.fund_eth()
    await w.fund_usdc()
    print(f'Buyer address: {w.address}')
asyncio.run(setup())
"
```

Save the address for step 4.

### 3. Start a merchant server

```bash
# FastAPI example
cd merchant-fastapi
SANGRIA_URL=http://localhost:8080 SANGRIA_SECRET_KEY="sg_test_xxx" uv run python src/main.py
```

Replace `sg_test_xxx` with your actual merchant API key.

### 4. Run the e2e test

```bash
cd playground
MERCHANT_URL=http://localhost:4004 uv run python -m e2e_test.client --buyer-address 0x...
```

See `e2e_test/README.md` for full details and expected output.

## Merchant server implementations

Each merchant server demonstrates integrating the Sangria SDK in a different framework. They all do the same thing:
- Expose a `GET /premium` endpoint
- Use the Sangria SDK's `@require_sangria_payment` decorator (or equivalent)
- The SDK handles the full 402 → generate → settle flow automatically

| Directory | Framework | Language |
|---|---|---|
| `merchant-fastapi/` | FastAPI | Python |
| `merchant-express/` | Express | Node.js |
| `merchant-fastify/` | Fastify | Node.js |
| `merchant-hono/` | Hono | Node.js |

## Legacy files

`main.py` and `merchant_server/` are the original standalone demo that talks directly to the x402 facilitator without the Sangria backend. Kept for reference.

## Important notes

- Runs on **Base Sepolia testnet** — all funds are fake
- CDP manages private keys server-side, encrypted with your `CDP_WALLET_SECRET`
- The buyer's private key is exported from CDP only to sign x402 payment headers
