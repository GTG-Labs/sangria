import { NextRequest } from "next/server";
import { env } from "@/lib/env";

export async function GET() {
  try {
    // Forward only the CSRF cookie. Passing the full browser cookie jar can
    // exceed backend header limits (431) due to large auth/session cookies.
    const csrfCookie = request.headers
      .get("cookie")
      ?.split(";")
      ?.find((cookie) => cookie.trim().startsWith("csrf_token="));
    const eqIdx = csrfCookie?.indexOf("=") ?? -1;
    const csrfToken =
      csrfCookie && eqIdx >= 0 ? csrfCookie.slice(eqIdx + 1).trim() : null;
    const cookieHeader = csrfToken ? `csrf_token=${csrfToken}` : "";

    // Proxy CSRF token request to Go backend
    const response = await fetch(`${env.BACKEND_URL}/csrf-token`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const data = await response.json();

    // Prepare response headers
    const responseHeaders = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });

    // Forward Set-Cookie headers from backend to frontend (preserve multiple cookies)
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const cookie of setCookies) {
      responseHeaders.append("Set-Cookie", cookie);
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Failed to fetch CSRF token from backend:", error);
    return new Response(
      JSON.stringify({ error: "Failed to generate CSRF token" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }
}
