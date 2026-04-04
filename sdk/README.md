# Sangria SDKs

These are simple SDKs merchants can add to easily accept payments. We integrate with a wide range of frameworks!

## Available SDKs

| SDK | Frameworks | Install |
|-----|-----------|---------|
| [TypeScript](./sdk-typescript/) | Express, Fastify, Hono | `pnpm add @sangrianet/core` |
| [Python](./python/) | FastAPI | `pip install sangria-merchant-sdk` |


The merchant writes zero payment logic. One middleware call handles the full x402 negotiation loop.
