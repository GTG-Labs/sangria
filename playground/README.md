# Sangria Playground

Example merchant servers and a test client for end-to-end [x402 payment protocol](https://www.x402.org/) testing against the Sangria backend.

## How it works

```
Buyer (agent-test)                   Merchant Server (:<port>)             Sangria Backend (:8080)
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
├── .env                       # CDP credentials (single source of truth)
├── agent-test/                # Buyer/agent test client (TypeScript)
│   ├── src/index.ts           # Tests exact + upto payment flows
│   ├── .env                   # PRIVATE_KEY + MERCHANT_URL only
│   ├── export-key.py          # Export a private key from CDP
│   └── list-wallets.py        # List all CDP accounts
├── merchant-express/          # Merchant server — Express
├── merchant-fastify/          # Merchant server — Fastify
├── merchant-hono/             # Merchant server — Hono
├── merchant-fastapi/          # Merchant server — FastAPI (Python)
├── merchant-nextjs/           # Merchant server — Next.js
├── wallet/
│   └── wallet.py              # CDP wallet helpers (create, fund, check balances)
├── e2e_test/                  # (Legacy) Python-based e2e test
├── merchant_server/           # (Legacy) Standalone demo without Sangria backend
└── main.py                    # (Legacy) Standalone buyer client
```

## Credentials setup

### CDP credentials (`playground/.env`)

CDP credentials live in `playground/.env` — this is the **single source of truth**. All Python scripts and wallet helpers load from here.

```bash
cp .env.example .env
```

Then fill in from the [CDP Portal](https://portal.cdp.coinbase.com) under your project's API Keys and Server Wallet settings:

```
CDP_API_KEY=<API key ID from portal>
CDP_SECRET_KEY=<API key secret>
CDP_WALLET_SECRET=<wallet secret from Server Wallet dashboard>
```

These are scoped to a single CDP project. All accounts created via the API or the portal under that project will be accessible.

### Agent test credentials (`agent-test/.env`)

The agent-test client only needs a buyer wallet private key and the merchant URL. **No CDP keys here** — those live in `playground/.env`.

```bash
cd agent-test && cp .env.example .env
```

```
PRIVATE_KEY=0x<exported private key>
MERCHANT_URL=http://localhost:4001
```

To export a private key from one of your CDP accounts:
```bash
cd playground
uv run python agent-test/export-key.py 0xYOUR_ACCOUNT_ADDRESS
```

### Merchant server credentials

Each merchant server needs a Sangria API key in its own `.env`:
```
SANGRIA_API_KEY=sg_test_xxx
```

## Quick start

### 1. Install dependencies

```bash
cd playground
uv sync                          # Python deps
cd agent-test && pnpm install    # agent-test deps
cd ../merchant-hono && pnpm install  # (or whichever merchant server)
```

### 2. Create and fund a buyer wallet (one-time)

```bash
cd playground
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

Then export the private key and put it in `agent-test/.env`:
```bash
uv run python agent-test/export-key.py 0xTHE_ADDRESS_FROM_ABOVE
# Copy the output into agent-test/.env as PRIVATE_KEY
```

### 3. Start the backend + a merchant server

```bash
# Terminal 1: backend
cd backend && go run .

# Terminal 2: merchant (pick one)
cd playground/merchant-hono && pnpm dev
```

### 4. Run the agent test

```bash
cd playground/agent-test
pnpm test          # both exact + upto
pnpm test:exact    # exact scheme only (/premium)
pnpm test:upto     # upto scheme only (/api/search)
```

## Merchant server implementations

Each merchant server demonstrates integrating the Sangria SDK in a different framework. They all expose:
- `GET /premium` — fixed-price endpoint (exact scheme, $0.01)
- `GET /api/search` — variable-price endpoint (upto scheme, up to $0.10)

| Directory | Framework | Language | Default Port |
|---|---|---|---|
| `merchant-express/` | Express | Node.js | 4001 |
| `merchant-fastify/` | Fastify | Node.js | 4002 |
| `merchant-hono/` | Hono | Node.js | 4003 |
| `merchant-fastapi/` | FastAPI | Python | 4004 |
| `merchant-nextjs/` | Next.js | Node.js | 3000 |

## Utility scripts

Run all Python scripts from the `playground/` directory:

```bash
cd playground

# List all CDP accounts in your project
uv run python agent-test/list-wallets.py

# Export a private key
uv run python agent-test/export-key.py 0xADDRESS
```

## Legacy files

`main.py`, `merchant_server/`, and `e2e_test/` are the original standalone demo that talks directly to the x402 facilitator without the Sangria backend. Kept for reference.
