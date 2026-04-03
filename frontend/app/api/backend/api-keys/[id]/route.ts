import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/api-proxy";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyToBackend("DELETE", `/api-keys/${id}`, { rawResponse: true });
}
