import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8080";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Get authenticated user and access token from session
    const { user, accessToken } = await withAuth();

    if (!user || !accessToken) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // Get API key ID from params
    const { id } = await params;

    // Forward request to backend with access token
    const response = await fetch(`${BACKEND_URL}/api-keys/${id}`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("API Keys DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}