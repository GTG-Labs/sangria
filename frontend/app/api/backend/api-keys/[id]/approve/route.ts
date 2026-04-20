import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/api-proxy";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyToBackend("POST", `/internal/api-keys/${encodeURIComponent(id)}/approve`, { rawResponse: true });
}