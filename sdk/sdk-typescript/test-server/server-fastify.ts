import Fastify from "fastify";
import { Sangria } from "../src/index.js";
import { sangriaPlugin, fixedPrice } from "../src/adapters/fastify.js";

const fastify = Fastify({ logger: false });

// ── Initialize Sangria ──
const sangria = new Sangria({
  apiKey: process.env.SANGRIA_SECRET_KEY ?? "sk_test_abc123",
  baseUrl: process.env.SANGRIA_URL ?? "http://localhost:8080",
});

// ── Register Sangria plugin ──
fastify.register(sangriaPlugin);

// ── Free endpoint ──
fastify.get("/", async () => {
  return { message: "Hello! This endpoint is free." };
});

// ── Fixed-price endpoint ──
fastify.get(
  "/premium",
  {
    preHandler: fixedPrice(sangria, {
      price: 0.01,
      description: "Access premium content",
    }),
  },
  async () => {
    return { message: "You accessed the premium endpoint!" };
  }
);

// ── Start ──
const PORT = Number(process.env.PORT ?? 3335);
await fastify.listen({ port: PORT });
console.log(`Fastify test server running on http://localhost:${PORT}`);
console.log(`  GET /         → free`);
console.log(`  GET /premium  → $0.01 (fixed)`);
