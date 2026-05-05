import "dotenv/config";
import express from "express";
import { Sangria } from "@sangria-sdk/core";
import { fixedPrice, uptoPrice } from "@sangria-sdk/core/express";

const app = express();
app.use(express.json());

const apiKey = process.env.SANGRIA_SECRET_KEY;
if (!apiKey) {
  throw new Error("SANGRIA_SECRET_KEY environment variable is required");
}

const sangria = new Sangria({
  apiKey,
  baseUrl: process.env.SANGRIA_URL ?? "http://localhost:8080",
});

app.get("/", (_req, res) => {
  res.json({ message: "Hello! This endpoint is free." });
});

app.get(
  "/premium",
  fixedPrice(sangria, { price: 0.01, description: "Access premium content" }),
  (_req, res) => {
    res.json({ message: "You accessed the premium endpoint!" });
  }
);

app.get(
  "/api/search",
  uptoPrice(
    sangria,
    { maxPrice: 0.10, description: "Search API — pay per result" },
    async (req, settle) => {
      const q = (req.query.q as string) ?? "";
      const results = Array.from(
        { length: Math.floor(Math.random() * 50) + 1 },
        (_, i) => `Result ${i + 1} for "${q}"`
      );
      const cost = results.length * 0.002;
      return settle(cost, { query: q, results, cost });
    }
  )
);

const PORT = Number(process.env.PORT ?? 4001);
app.listen(PORT, () => {
  console.log(`Express merchant server running on http://localhost:${PORT}`);
  console.log(`  GET /             → free`);
  console.log(`  GET /premium      → $0.01 (fixed)`);
  console.log(`  GET /api/search   → up to $0.10 (variable)`);
});
