import Fastify from "fastify";
import { SangriaNet } from "@sangrianet/core";
import { sangrianetPlugin, fixedPrice } from "@sangrianet/core/fastify";

const fastify = Fastify({ logger: false });

const sangrianet = new SangriaNet({
  apiKey: process.env.SANGRIA_SECRET_KEY ?? "sk_test_abc123",
  baseUrl: process.env.SANGRIA_URL ?? "http://localhost:8080",
});

fastify.register(sangrianetPlugin);

fastify.get("/", async () => {
  return { message: "Hello! This endpoint is free." };
});

fastify.get(
  "/premium",
  { preHandler: fixedPrice(sangrianet, { price: 0.01, description: "Access premium content" }) },
  async () => {
    return { message: "You accessed the premium endpoint!" };
  }
);

const PORT = Number(process.env.PORT ?? 4002);
await fastify.listen({ port: PORT });
console.log(`Fastify merchant server running on http://localhost:${PORT}`);
console.log(`  GET /         → free`);
console.log(`  GET /premium  → $0.01 (fixed)`);
