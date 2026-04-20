import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/api-proxy";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const queryString = url.searchParams.toString();
  const path = queryString
    ? `/admin/withdrawals?${queryString}`
    : "/admin/withdrawals";
  return proxyToBackend("GET", path);
}
