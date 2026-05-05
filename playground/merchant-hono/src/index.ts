import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Sangria } from "@sangria-sdk/core";
import { fixedPrice, uptoPrice } from "@sangria-sdk/core/hono";

const app = new Hono();

const apiKey = process.env.SANGRIA_SECRET_KEY;
if (!apiKey) {
  throw new Error("SANGRIA_SECRET_KEY environment variable is required");
}

const sangria = new Sangria({
  apiKey,
  baseUrl: process.env.SANGRIA_URL ?? "http://localhost:8080",
});

app.get("/", (c) => {
  return c.json({ message: "Hello! This endpoint is free." });
});

app.get(
  "/premium",
  fixedPrice(sangria, { price: 0.01, description: "Access premium content" }),
  (c) => {
    return c.json({ message: "You accessed the premium endpoint!" });
  }
);

app.get(
  "/api/search",
  uptoPrice(
    sangria,
    { maxPrice: 0.10, description: "Search API — pay per result" },
    async (c, settle) => {
      const q = c.req.query("q") ?? "";
      const results = Array.from(
        { length: Math.floor(Math.random() * 50) + 1 },
        (_, i) => `Result ${i + 1} for "${q}"`
      );
      const cost = results.length * 0.002;
      return settle(cost, { query: q, results, cost });
    }
  )
);

const PORT = Number(process.env.PORT ?? 4003);
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Hono merchant server running on http://localhost:${PORT}`);
  console.log(`  GET /             → free`);
  console.log(`  GET /premium      → $0.01 (fixed)`);
  console.log(`  GET /api/search   → up to $0.10 (variable)`);
});
