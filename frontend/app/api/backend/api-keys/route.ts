import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8080";

export async function GET() {
  try {
    // Get authenticated user and access token from session
    const { user, accessToken } = await withAuth();

    if (!user || !accessToken) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // Forward request to backend with access token
    const response = await fetch(`${BACKEND_URL}/api-keys`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("API Keys GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user and access token from session
    const { user, accessToken } = await withAuth();

    if (!user || !accessToken) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // Get request body
    const body = await request.json();

    // Forward request to backend with access token
    const response = await fetch(`${BACKEND_URL}/api-keys`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("API Keys POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}