import { proxyToBackend } from "@/lib/api-proxy";

export async function GET() {
  return proxyToBackend("GET", "/internal/balance");
}
