import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Sangria } from "@sangria-sdk/core";
import { fixedPrice } from "@sangria-sdk/core/hono";

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

const PORT = Number(process.env.PORT ?? 4003);
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Hono merchant server running on http://localhost:${PORT}`);
  console.log(`  GET /         → free`);
  console.log(`  GET /premium  → $0.01 (fixed)`);
});
