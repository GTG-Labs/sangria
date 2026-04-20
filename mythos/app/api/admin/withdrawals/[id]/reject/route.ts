import { NextRequest, NextResponse } from "next/server";
import { proxyToBackend } from "@/lib/api-proxy";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const raw = await request.text();
  let body: unknown;
  if (raw.trim() !== "") {
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }
  return proxyToBackend("POST", `/admin/withdrawals/${encodeURIComponent(id)}/reject`, { body });
}
