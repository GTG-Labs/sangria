import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/api-proxy";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const queryString = new URLSearchParams();

  const passthrough = ["limit", "cursor", "organization_id", "search", "start_date", "end_date"];
  for (const key of passthrough) {
    const val = searchParams.get(key);
    if (val) queryString.set(key, val);
  }

  const path = `/admin/transactions${queryString.toString() ? `?${queryString}` : ""}`;
  return proxyToBackend("GET", path);
}
