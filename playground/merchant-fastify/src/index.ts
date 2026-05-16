import "dotenv/config";
import Fastify from "fastify";
import { Sangria } from "@sangria-sdk/core";
import { sangriaPlugin, fixedPrice, uptoPrice, computedPrice } from "@sangria-sdk/core/fastify";

const fastify = Fastify({ logger: false });

const apiKey = process.env.SANGRIA_SECRET_KEY;
if (!apiKey) {
  throw new Error("SANGRIA_SECRET_KEY environment variable is required");
}

const sangria = new Sangria({
  apiKey,
  baseUrl: process.env.SANGRIA_URL ?? "http://localhost:8080",
});

fastify.register(sangriaPlugin, { sangria });

fastify.get("/", async () => {
  return { message: "Hello! This endpoint is free." };
});

fastify.get(
  "/premium",
  fixedPrice(
    sangria,
    { price: 0.01, description: "Access premium content" },
    async () => {
      return { message: "You accessed the premium endpoint!" };
    }
  )
);

fastify.get(
  "/api/search",
  uptoPrice(
    sangria,
    { maxPrice: 0.10, description: "Search API — pay per result" },
    async (request, settle) => {
      const q = (request.query as Record<string, string>).q ?? "";
      const results = Array.from(
        { length: Math.floor(Math.random() * 50) + 1 },
        (_, i) => `Result ${i + 1} for "${q}"`
      );
      const cost = results.length * 0.002;
      return settle(cost, { query: q, results, cost });
    }
  )
);

const LATTE_PRICE = 0.02;

const calcLattePrice = async (request: import("fastify").FastifyRequest) => {
  const body = request.body as { quantity?: number } | undefined;
  const qty = Math.max(1, Math.floor(body?.quantity ?? 1));
  return qty * LATTE_PRICE;
};

fastify.post(
  "/latte",
  computedPrice(calcLattePrice, async (_request, _reply, transaction) => {
    const qty = Math.floor(transaction.amount / LATTE_PRICE);
    return {
      order: "latte",
      quantity: qty,
      total: transaction.amount,
      transactionHash: transaction.hash,
    };
  })
);

const PORT = Number(process.env.PORT ?? 4002);
await fastify.listen({ port: PORT });
console.log(`Fastify merchant server running on http://localhost:${PORT}`);
console.log(`  GET  /             → free`);
console.log(`  GET  /premium      → $0.01 (fixed)`);
console.log(`  GET  /api/search   → up to $0.10 (variable)`);
console.log(`  POST /latte        → $0.02/latte (computed)`);
