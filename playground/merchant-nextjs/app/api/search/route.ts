import { NextRequest } from "next/server";
import { Sangria } from "@sangria-sdk/core";
import { uptoPrice } from "@sangria-sdk/core/nextjs";

const apiKey = process.env.SANGRIA_SECRET_KEY;
if (!apiKey) {
  throw new Error("SANGRIA_SECRET_KEY environment variable is required");
}

const sangria = new Sangria({
  apiKey,
  baseUrl: process.env.SANGRIA_URL ?? "http://localhost:8080",
});

// GET /api/search → up to $0.10 (variable)
export const GET = uptoPrice(
  sangria,
  { maxPrice: 0.10, description: "Search API — pay per result" },
  async (request: NextRequest, settle) => {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    const results = Array.from(
      { length: Math.floor(Math.random() * 50) + 1 },
      (_, i) => `Result ${i + 1} for "${q}"`
    );
    const cost = results.length * 0.002;
    return settle(cost, { query: q, results, cost });
  }
);
