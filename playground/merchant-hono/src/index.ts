import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { SangriaNet } from "@sangrianet/core";
import { fixedPrice } from "@sangrianet/core/hono";

const app = new Hono();

const sangrianet = new SangriaNet({
  apiKey: process.env.SANGRIA_SECRET_KEY ?? "sk_test_abc123",
  baseUrl: process.env.SANGRIA_URL ?? "http://localhost:8080",
});

app.get("/", (c) => {
  return c.json({ message: "Hello! This endpoint is free." });
});

app.get(
  "/premium",
  fixedPrice(sangrianet, { price: 0.01, description: "Access premium content" }),
  (c) => {
    return c.json({ message: "You accessed the premium endpoint!" });
  }
);

const PORT = Number(process.env.PORT ?? 4003);
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Hono merchant server running on http://localhost:${PORT}`);
  console.log(`  GET /         → free`);
  console.log(`  GET /premium  → $0.01 (fixed)`);
});
