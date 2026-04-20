import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/api-proxy";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const { id, userId } = await params;
  return proxyToBackend("DELETE", `/internal/organizations/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { rawResponse: true });
}