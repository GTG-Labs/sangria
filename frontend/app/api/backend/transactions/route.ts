import { proxyToBackend } from "@/lib/api-proxy";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = searchParams.get("limit") || "";
  const cursor = searchParams.get("cursor") || "";

  const queryString = new URLSearchParams();
  if (limit) queryString.set("limit", limit);
  if (cursor) queryString.set("cursor", cursor);

  const path = `/transactions${queryString.toString() ? `?${queryString}` : ""}`;
  return proxyToBackend("GET", path);
}
