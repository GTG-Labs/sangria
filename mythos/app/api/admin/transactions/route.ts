import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/api-proxy";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = searchParams.get("limit") || "";
  const cursor = searchParams.get("cursor") || "";

  const queryString = new URLSearchParams();
  if (limit) queryString.set("limit", limit);
  if (cursor) queryString.set("cursor", cursor);

  const path = `/admin/transactions${queryString.toString() ? `?${queryString}` : ""}`;
  return proxyToBackend("GET", path);
}
