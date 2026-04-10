import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/api-proxy";

export async function GET() {
  return proxyToBackend("GET", "/internal/api-keys");
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  return proxyToBackend("POST", "/internal/merchants", { body });
}