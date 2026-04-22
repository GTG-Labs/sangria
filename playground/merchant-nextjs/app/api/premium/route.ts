import { NextRequest, NextResponse } from "next/server";
import { Sangria } from "@sangria-sdk/core";
import { fixedPrice } from "@sangria-sdk/core/nextjs";

const apiKey = process.env.SANGRIA_SECRET_KEY;
if (!apiKey) {
  throw new Error("SANGRIA_SECRET_KEY environment variable is required");
}

const sangria = new Sangria({
  apiKey,
  baseUrl: process.env.SANGRIA_URL ?? "http://localhost:8080",
});

// GET /api/premium → $0.01 (fixed)
export const GET = fixedPrice(
  sangria,
  { price: 0.01, description: "Access premium content" },
  async (_request: NextRequest) => {
    return NextResponse.json({
      message: "You accessed the premium endpoint!",
    });
  }
);
