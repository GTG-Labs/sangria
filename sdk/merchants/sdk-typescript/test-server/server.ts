import express from "express";
import { Sangria } from "../src/index.js";
import { fixedPrice } from "../src/adapters/express.js";

const app = express();
app.use(express.json());

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
app.get("/", (_req, res) => {
  res.json({ message: "Hello! This endpoint is free." });
});

// ── Fixed-price endpoint ──
app.get(
  "/premium",
  fixedPrice(sangria, { price: 0.01, description: "Access premium content" }),
  (_req, res) => {
    res.json({ message: "You accessed the premium endpoint!" });
  }
);

// ── Start ──
const PORT = process.env.PORT ?? 3333;
app.listen(PORT, () => {
  console.log(`Test server running on http://localhost:${PORT}`);
  console.log(`  GET /         → free`);
  console.log(`  GET /premium  → $0.01 (fixed)`);
});
