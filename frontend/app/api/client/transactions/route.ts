import { proxyToBackend } from "@/lib/api-proxy";

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams.toString();
  const path = search
    ? `/internal/client/transactions?${search}`
    : "/internal/client/transactions";
  return proxyToBackend("GET", path, {}, request);
}
