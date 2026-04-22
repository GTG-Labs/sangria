import Fastify from "fastify";
import { Sangria } from "@sangria-sdk/core";
import { sangriaPlugin, fixedPrice } from "@sangria-sdk/core/fastify";

const fastify = Fastify({ logger: false });

const apiKey = process.env.SANGRIA_SECRET_KEY;
if (!apiKey) {
  throw new Error("SANGRIA_SECRET_KEY environment variable is required");
}

const sangria = new Sangria({
  apiKey,
  baseUrl: process.env.SANGRIA_URL ?? "http://localhost:8080",
});

fastify.register(sangriaPlugin);

fastify.get("/", async () => {
  return { message: "Hello! This endpoint is free." };
});

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

const PORT = Number(process.env.PORT ?? 4002);
await fastify.listen({ port: PORT });
console.log(`Fastify merchant server running on http://localhost:${PORT}`);
console.log(`  GET /         → free`);
console.log(`  GET /premium  → $0.01 (fixed)`);
