import { proxyToBackend } from "@/lib/api-proxy";

export async function GET(request: Request) {
  return proxyToBackend("GET", "/internal/client/agent", {}, request);
}
