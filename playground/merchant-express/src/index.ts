import express from "express";
import { SangriaNet } from "@sangrianet/core";
import { fixedPrice } from "@sangrianet/core/express";

const app = express();
app.use(express.json());

const sangrianet = new SangriaNet({
  apiKey: process.env.SANGRIA_SECRET_KEY ?? "sk_test_abc123",
  baseUrl: process.env.SANGRIA_URL ?? "http://localhost:8080",
});

app.get("/", (_req, res) => {
  res.json({ message: "Hello! This endpoint is free." });
});

app.get(
  "/premium",
  fixedPrice(sangrianet, { price: 0.01, description: "Access premium content" }),
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
