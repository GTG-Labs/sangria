# Sangria SDKs

Merchant SDKs for accepting x402 payments on any API endpoint. Add a single middleware/decorator and your endpoint is paywalled with USDC settlement on Base.

## Available SDKs

| SDK | Frameworks | Install |
|-----|-----------|---------|
| [TypeScript](./sdk-typescript/) | Express, Fastify, Hono | `pnpm add @sangrianet/core` |
| [Python](./python/) | FastAPI | `pip install sangria-merchant-sdk` |

## How it works

1. Client hits your endpoint -- SDK returns `402 Payment Required` with x402 v2 payment terms
2. Client signs an EIP-712 authorization and retries with a `payment-signature` header
3. SDK forwards the signature to Sangria -- USDC settles on-chain, your handler runs

The merchant writes zero payment logic. One middleware call handles the full x402 negotiation loop.
