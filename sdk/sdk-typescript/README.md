# @sangria-sdk/core

TypeScript SDK for accepting x402 payments. Supports Express, Fastify, and Hono.

## Install

```bash
pnpm add @sangria-sdk/core
```

## Quick Start

### Express

```typescript
import express from "express";
import { Sangria } from "@sangria-sdk/core";
import { fixedPrice } from "@sangria-sdk/core/express";

const app = express();
const sangria = new Sangria({
  apiKey: process.env.SANGRIA_SECRET_KEY,
  baseUrl: "https://api.sangria.net",
});

app.get(
  "/premium",
  fixedPrice(sangria, { price: 0.01, description: "Premium content" }),
  (req, res) => {
    // req.sangria.paid === true
    // req.sangria.transaction === "0x..."
    res.json({ data: "premium content" });
  }
);

app.listen(3000);
```

### Fastify

```typescript
import Fastify from "fastify";
import { Sangria } from "@sangria-sdk/core";
import { sangriaPlugin, fixedPrice } from "@sangria-sdk/core/fastify";

const app = Fastify();
const sangria = new Sangria({ apiKey: process.env.SANGRIA_SECRET_KEY });

await app.register(sangriaPlugin);

app.get(
  "/premium",
  { preHandler: fixedPrice(sangria, { price: 0.01 }) },
  (request, reply) => {
    // request.sangria.paid === true
    reply.send({ data: "premium content" });
  }
);

await app.listen({ port: 3000 });
```

### Hono

```typescript
import { Hono } from "hono";
import { Sangria } from "@sangria-sdk/core";
import { fixedPrice, getSangria } from "@sangria-sdk/core/hono";

const app = new Hono();
const sangria = new Sangria({ apiKey: process.env.SANGRIA_SECRET_KEY });

app.get("/premium", fixedPrice(sangria, { price: 0.01 }), (c) => {
  const payment = getSangria(c);
  // payment.paid === true
  return c.json({ data: "premium content" });
});

export default app;
```

## Bypass Payments

All adapters support a `bypassPaymentIf` option to skip payment for certain requests. This is useful if you want to let API key users access your endpoints for free while charging anonymous or agent-based callers via x402:

```typescript
fixedPrice(
  sangria,
  { price: 0.01 },
  {
    bypassPaymentIf: (req) => !!req.headers["x-api-key"],
  }
);
```

## Configuration

```typescript
const sangria = new Sangria({
  apiKey: "sg_live_...", // Required. Your Sangria merchant API key.
  baseUrl: "https://...", // Optional. Defaults to http://localhost:8080.
});
```

## How It Works

The `fixedPrice` middleware handles the x402 negotiation loop:

1. **First request** (no `payment-signature` header): calls Sangria's `/v1/generate-payment` endpoint, returns `402 Payment Required` with payment terms to the client.
2. **Retry** (with `payment-signature` header): forwards the signed payload to Sangria's `/v1/settle-payment` endpoint. On success, attaches payment data to the request and calls your handler.

## Requirements

- Node.js >= 18
- One of: Express >= 4, Fastify >= 4, or Hono >= 4
