import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Defensive: strip csrf_token from the body before forwarding. Current
    // clients send it as the X-CSRF-Token header only, not in the body, so
    // this is a no-op for normal traffic. Kept to stop a misbehaving client
    // from leaking the raw token into the backend's /internal/* handlers.
    const { csrf_token: _csrf_token, ...sanitizedBody } = body;

    // Call backend directly (no auth required)
    const response = await fetch(`${env.BACKEND_URL}/accept-invitation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sanitizedBody),
    });

    const data = await response.text();

    return new NextResponse(data, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Failed to accept invitation:", error);
    return NextResponse.json(
      { error: "Failed to connect to backend" },
      { status: 500 }
    );
  }
}