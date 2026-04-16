import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/api-proxy";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const queryString = url.searchParams.toString();
  const path = queryString
    ? `/internal/withdrawals?${queryString}`
    : "/internal/withdrawals";
  return proxyToBackend("GET", path);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  return proxyToBackend("POST", "/internal/withdrawals", { body });
}
