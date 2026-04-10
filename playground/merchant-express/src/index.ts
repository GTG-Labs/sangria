import express from "express";
import { Sangria } from "@sangria-sdk/core";
import { fixedPrice } from "@sangria-sdk/core/express";

const app = express();
app.use(express.json());

const sangria = new Sangria({
  apiKey: process.env.SANGRIA_SECRET_KEY ?? "sk_test_abc123",
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

const PORT = Number(process.env.PORT ?? 4001);
app.listen(PORT, () => {
  console.log(`Express merchant server running on http://localhost:${PORT}`);
  console.log(`  GET /         → free`);
  console.log(`  GET /premium  → $0.01 (fixed)`);
});
