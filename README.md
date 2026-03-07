# sangria-net

A demo of the [x402 payment protocol](https://www.x402.org/) — HTTP-native micropayments using USDC on Base Sepolia (testnet).

A merchant runs a FastAPI server with a paid endpoint. A buyer client calls that endpoint. The x402 protocol handles payment negotiation automatically: the server responds with a `402 Payment Required`, the client signs a USDC payment, and the server verifies it before returning the real response. No payment UI, no checkout flow — just an HTTP request that costs money.

## How it works

```
Buyer (main.py)                          Merchant Server (:8000)
       |                                        |
       |  GET /premium                          |
       |--------------------------------------->|
       |                                        |
       |  402 Payment Required ($0.0001 USDC)   |
       |<---------------------------------------|
       |                                        |
       |  GET /premium + signed USDC payment    |
       |--------------------------------------->|
       |                                        |
       |  200 OK { "paid": true }               |
       |<---------------------------------------|
```

The x402 client library handles the 402 negotiation transparently. From the developer's perspective, it's just a normal HTTP GET.

## Project structure

```
sangria-net/
  main.py                  # Buyer client — checks balances, calls the paid endpoint
  merchant_server/
    app.py                 # FastAPI app with the @pay-protected endpoint
    run.py                 # Entry point: python -m merchant_server.run
  wallet/
    wallet.py              # TestnetWallet class — create, fund, and check wallets via CDP
```

## Prerequisites

- Python 3.10+
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- A [Coinbase Developer Platform](https://portal.cdp.coinbase.com/) account

## Setup

1. Clone the repo:

```bash
git clone https://github.com/your-username/sangria-net.git
cd sangria-net
```

2. Install dependencies:

```bash
uv sync
```

3. Create a `.env` file from the example:

```bash
cp .env.example .env
```

4. Fill in your CDP credentials in `.env`:

```
CDP_API_KEY="your-api-key"
CDP_SECRET_KEY="your-secret-key"
CDP_WALLET_SECRET="your-wallet-secret"
```

You get these from the [CDP Portal](https://portal.cdp.coinbase.com/). The wallet secret is an encryption key you choose — CDP uses it to encrypt your wallet private keys on their servers.

## Running

You need two terminals.

**Terminal 1 — Start the merchant server:**

```bash
uv run python -m merchant_server.run
```

This starts a FastAPI server on `http://127.0.0.1:8000` with:
- `GET /` — health check
- `GET /premium` — costs $0.0001 USDC per request (protected by x402)

**Terminal 2 — Run the buyer client:**

```bash
uv run python main.py
```

This will:
1. Print initial USDC balances for both the merchant and buyer wallets
2. Make a single paid request to `GET /premium`
3. Wait a few seconds for on-chain settlement
4. Print final balances showing the USDC transfer

## Example output

```
--- Initial Balances ---
  Merchant (0xF44c...fd39): 10.050000 USDC
  Buyer    (0x0b7b...e649):  9.950000 USDC

Status: 200 | Body: {'message': 'You accessed the premium endpoint!', 'paid': True}

Waiting for settlement...

--- Final Balances ---
  Merchant (0xF44c...fd39): 10.050100 USDC
  Buyer    (0x0b7b...e649):  9.949900 USDC
```

## Wallet management

The project uses pre-created wallets with addresses hardcoded in `main.py` and `merchant_server/app.py`. If you need to create and fund new wallets, you can use the `TestnetWallet` class:

```python
import asyncio
from wallet import TestnetWallet

async def setup():
    wallet = await TestnetWallet.mint()    # creates a new wallet
    await wallet.fund_eth()                # gas fees (free on testnet)
    await wallet.fund_usdc()               # payment token (free on testnet)
    print(wallet.address)                  # save this address

asyncio.run(setup())
```

Then update `MERCHANT_ADDRESS` and `BUYER_ADDRESS` in the code with your new addresses.

## Key dependencies

| Package | What it does |
|---|---|
| `cdp-sdk` | Coinbase Developer Platform SDK — wallet creation, funding, balance checks |
| `x402` | Client-side x402 protocol — signs USDC payments for 402 responses |
| `fastapi-x402` | Server-side x402 middleware — adds `@pay` decorator to protect endpoints |
| `uvicorn` | ASGI server to run FastAPI |

## Important notes

- This runs on **Base Sepolia testnet** — all funds are fake. No real money is involved.
- CDP manages private keys server-side. The wallet secret in your `.env` encrypts them at rest — don't lose it or you lose access to your wallets.
- The buyer's private key is exported from CDP only to sign x402 payment headers. This is the one place where the raw key is used locally.
