import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Sangria } from "../src/index.js";
import { fixedPrice } from "../src/adapters/hono.js";

const app = new Hono();

// ── Initialize Sangria ──
const apiKey = process.env.SANGRIA_SECRET_KEY;
if (!apiKey) {
  throw new Error("SANGRIA_SECRET_KEY environment variable is required");
}

const sangria = new Sangria({
  apiKey,
  baseUrl: process.env.SANGRIA_URL ?? "http://localhost:8080",
});

// ── Free endpoint ──
app.get("/", (c) => {
  return c.json({ message: "Hello! This endpoint is free." });
});

// ── Fixed-price endpoint ──
app.get(
  "/premium",
  fixedPrice(sangria, { price: 0.01, description: "Access premium content" }),
  (c) => {
    return c.json({ message: "You accessed the premium endpoint!" });
  }
);

// ── Start ──
const PORT = Number(process.env.PORT ?? 3334);
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Hono test server running on http://localhost:${PORT}`);
  console.log(`  GET /         → free`);
  console.log(`  GET /premium  → $0.01 (fixed)`);
});
